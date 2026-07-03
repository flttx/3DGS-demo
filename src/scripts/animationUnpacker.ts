/**
 * 动画解包器
 * 端口自 awa-community-web/src/pages/3d-editor/scripts/animation-unpacker.ts
 *
 * 关键原理：animation_track.npz 不是完整的高斯 splat，而是一条动画轨迹，
 * 只含 positions / rotations / shape 三个数组。它必须和 base_perfect.ply 模板
 * 组合，逐帧重建出每一帧的 PLY 字节，再交给 PlayCanvas 加载。
 *
 * PLY 顶点布局（VERTEX_STRIDE = 68 字节）：
 *   x@0, y@4, z@8                       ← 位置（逐帧覆盖）
 *   ... 颜色/缩放/不透明度/SH ...        ← 来自模板（静态）
 *   rot_0@52, rot_1@56, rot_2@60, rot_3@64 ← 旋转（逐帧覆盖）
 */
import { parseNpz, type NpyArray } from '../lib/npy';
import { formatProgress, streamUrl } from '../lib/streamFetch';

const VERTEX_STRIDE = 68;

const FIELD_OFFSET = {
  x: 0,
  y: 4,
  z: 8,
  rot_0: 52,
  rot_1: 56,
  rot_2: 60,
  rot_3: 64,
} as const;

export interface FrameDescriptor {
  cacheKey: string;
  frameIdx: number;
  file: {
    url: string;
    filename: string;
    contents: Response;
  };
}

export interface AnimationLoadOptions {
  basePlyUrl: string;
  npzUrl: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export interface AnimationLoadResult {
  numFrames: number;
  numPoints: number;
  endFrame: number;
}

interface PlyData {
  headerBytes: Uint8Array;
  vertexTemplate: Uint8Array;
}

interface PlyStreamParser {
  append(chunk: Uint8Array): void;
  finalize(): void;
  done: Promise<PlyData>;
}

function toNumberArray(arrayLike: NpyArray['data']): Float32Array {
  if (arrayLike instanceof Float32Array) return arrayLike;
  return Float32Array.from(arrayLike, Number);
}

function decodeShape(shapeEntry: NpyArray): { numFrames: number; numPoints: number } {
  const values = Array.from(shapeEntry.data, Number);
  if (values.length !== 2) {
    throw new Error(`Unexpected animation shape: ${values.join(', ')}`);
  }
  return { numFrames: values[0], numPoints: values[1] };
}

/**
 * 从 NPZ + 基底 PLY 模板在内存中重建动画帧。
 * 等价于 YG_unzip_ver2.py —— positions/rotations 数组，不落盘。
 */
export class AnimationUnpacker {
  numFrames = 0;
  numPoints = 0;
  headerBytes: Uint8Array | null = null;
  vertexTemplate: Uint8Array | null = null;
  positions: Float32Array | null = null;
  rotations: Float32Array | null = null;
  plyByteCache = new Map<number, Uint8Array>();
  plyCacheOrder: number[] = [];
  maxPlyCache = 30;

  async load({
    basePlyUrl,
    npzUrl,
    onProgress,
    signal,
  }: AnimationLoadOptions): Promise<AnimationLoadResult> {
    const plyParser = createPlyStreamParser();

    let plyLoaded = 0;
    let plyTotal = 0;
    let npzLoaded = 0;
    let npzTotal = 0;

    const reportProgress = (phase: string) => {
      const plyPart = formatProgress(plyLoaded, plyTotal);
      const npzPart = formatProgress(npzLoaded, npzTotal);
      onProgress?.(`${phase} · PLY ${plyPart} · NPZ ${npzPart}`);
    };

    onProgress?.('正在加载动画资源...');
    reportProgress('加载中');

    const streamOptions = signal ? { signal } : undefined;

    const npzBufferPromise = (async () => {
      const chunks: Uint8Array[] = [];
      await streamUrl(
        npzUrl,
        (chunk, final, loaded, total) => {
          npzLoaded = loaded;
          npzTotal = total;
          if (chunk) chunks.push(chunk);
          if (final) reportProgress('加载/解压中');
        },
        streamOptions,
      );
      // 合并 chunks 后一次性解压 NPZ
      const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      return parseNpz(merged.buffer);
    })();

    await Promise.all([
      streamUrl(
        basePlyUrl,
        (chunk, final, loaded, total) => {
          plyLoaded = loaded;
          plyTotal = total;
          if (chunk) plyParser.append(chunk);
          if (final) plyParser.finalize();
          reportProgress('加载/解压中');
        },
        streamOptions,
      ),
      npzBufferPromise,
    ]);

    onProgress?.('正在解析基底 PLY 与动画轨迹...');
    const [plyData, npz] = await Promise.all([plyParser.done, npzBufferPromise]);
    this.applyBasePly(plyData);

    if (!npz.positions || !npz.rotations) {
      const found = Object.keys(npz).join(', ') || '无';
      throw new Error(`NPZ 缺少 positions 或 rotations（已解析: ${found}）`);
    }

    const { numFrames, numPoints } = decodeShape(npz.shape);
    this.numFrames = numFrames;
    this.numPoints = numPoints;

    onProgress?.(`正在转换动画数据（${numFrames} 帧 × ${numPoints} 点）...`);
    this.positions = toNumberArray(npz.positions.data);
    this.rotations = toNumberArray(npz.rotations.data);

    const expectedPos = numFrames * numPoints * 3;
    const expectedRot = numFrames * numPoints * 4;

    if (this.positions.length !== expectedPos) {
      throw new Error(`positions 长度不匹配: ${this.positions.length} != ${expectedPos}`);
    }
    if (this.rotations.length !== expectedRot) {
      throw new Error(`rotations 长度不匹配: ${this.rotations.length} != ${expectedRot}`);
    }

    const templatePoints = this.vertexTemplate!.length / VERTEX_STRIDE;
    if (templatePoints !== numPoints) {
      throw new Error(`PLY 顶点数 (${templatePoints}) 与 NPZ (${numPoints}) 不一致`);
    }

    onProgress?.(`准备就绪，共 ${numFrames} 帧（按需生成 PLY）`);

    return { numFrames, numPoints, endFrame: numFrames - 1 };
  }

  applyBasePly({ headerBytes, vertexTemplate }: PlyData): void {
    this.headerBytes = headerBytes;
    this.vertexTemplate = vertexTemplate;

    if (this.vertexTemplate.length % VERTEX_STRIDE !== 0) {
      throw new Error('PLY 顶点数据长度无效');
    }
  }

  /** 用第 frameIdx 帧的 positions/rotations 覆盖模板，重建该帧的 PLY 字节。 */
  buildFramePly(frameIdx: number): Uint8Array {
    if (frameIdx < 0 || frameIdx >= this.numFrames) {
      throw new Error(`Frame ${frameIdx} out of range`);
    }

    const body = new Uint8Array(this.vertexTemplate!);
    const view = new DataView(body.buffer);

    const posBase = frameIdx * this.numPoints * 3;
    const rotBase = frameIdx * this.numPoints * 4;

    for (let point = 0; point < this.numPoints; point++) {
      const base = point * VERTEX_STRIDE;
      const pi = posBase + point * 3;
      const ri = rotBase + point * 4;

      view.setFloat32(base + FIELD_OFFSET.x, this.positions![pi], true);
      view.setFloat32(base + FIELD_OFFSET.y, this.positions![pi + 1], true);
      view.setFloat32(base + FIELD_OFFSET.z, this.positions![pi + 2], true);

      view.setFloat32(base + FIELD_OFFSET.rot_0, this.rotations![ri], true);
      view.setFloat32(base + FIELD_OFFSET.rot_1, this.rotations![ri + 1], true);
      view.setFloat32(base + FIELD_OFFSET.rot_2, this.rotations![ri + 2], true);
      view.setFloat32(base + FIELD_OFFSET.rot_3, this.rotations![ri + 3], true);
    }

    const ply = new Uint8Array(this.headerBytes!.length + body.length);
    ply.set(this.headerBytes!, 0);
    ply.set(body, this.headerBytes!.length);
    return ply;
  }

  getFrameCacheKey(frameIdx: number): string {
    return `frame:${frameIdx}`;
  }

  getFramePlyBytes(frameIdx: number): Uint8Array {
    const cached = this.plyByteCache.get(frameIdx);
    if (cached) {
      this.touchPlyCache(frameIdx);
      return cached;
    }

    const ply = this.buildFramePly(frameIdx);
    this.plyByteCache.set(frameIdx, ply);
    this.plyCacheOrder.push(frameIdx);
    this.evictPlyCache();
    return ply;
  }

  touchPlyCache(frameIdx: number): void {
    const index = this.plyCacheOrder.indexOf(frameIdx);
    if (index >= 0) {
      this.plyCacheOrder.splice(index, 1);
      this.plyCacheOrder.push(frameIdx);
    }
  }

  evictPlyCache(): void {
    while (this.plyCacheOrder.length > this.maxPlyCache) {
      const oldest = this.plyCacheOrder.shift();
      if (oldest !== undefined) {
        this.plyByteCache.delete(oldest);
      }
    }
  }

  /**
   * 给 PlayCanvas 用的稳定描述符 —— 通过 file.contents 从内存加载，不走 blob fetch。
   */
  getFrameDescriptor(frameIdx: number): FrameDescriptor {
    const ply = this.getFramePlyBytes(frameIdx);
    const filename = `frame_${String(frameIdx).padStart(4, '0')}.ply`;
    return {
      cacheKey: this.getFrameCacheKey(frameIdx),
      frameIdx,
      file: {
        url: `memory://${filename}`,
        filename,
        contents: new Response(ply as BlobPart, {
          headers: { 'Content-Length': String(ply.byteLength) },
        }),
      },
    };
  }

  releaseFrameCache(frameIdx: number): void {
    const index = this.plyCacheOrder.indexOf(frameIdx);
    if (index >= 0) {
      this.plyCacheOrder.splice(index, 1);
    }
    this.plyByteCache.delete(frameIdx);
  }

  destroy(): void {
    this.plyByteCache.clear();
    this.plyCacheOrder.length = 0;
  }
}

const END_HEADER_MARKER = new TextEncoder().encode('end_header\n');

function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i <= bytes.length - END_HEADER_MARKER.length; i++) {
    let matched = true;
    for (let j = 0; j < END_HEADER_MARKER.length; j++) {
      if (bytes[i + j] !== END_HEADER_MARKER[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return i + END_HEADER_MARKER.length;
    }
  }
  return -1;
}

function createPlyStreamParser(): PlyStreamParser {
  let bytes = new Uint8Array(0);
  let headerEnd = -1;
  let resolveDone!: (value: PlyData) => void;
  let rejectDone!: (reason?: unknown) => void;
  let settled = false;

  const done = new Promise<PlyData>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function append(chunk: Uint8Array): void {
    const next = new Uint8Array(bytes.length + chunk.length);
    next.set(bytes);
    next.set(chunk, bytes.length);
    bytes = next;

    if (headerEnd < 0) {
      headerEnd = findHeaderEnd(bytes);
    }
  }

  function finalize(): void {
    if (settled) return;
    settled = true;

    if (headerEnd < 0) {
      rejectDone(new Error('PLY 文件缺少 end_header'));
      return;
    }

    resolveDone({
      headerBytes: bytes.slice(0, headerEnd),
      vertexTemplate: bytes.slice(headerEnd),
    });
  }

  return { append, finalize, done };
}
