/**
 * NumPy .npy / .npz 浏览器端解析器
 * 端口自 awa-community-web/src/pages/3d-editor/lib/npy.ts
 *
 * 支持 dtype：float16(手动解码)、float32、float64、int32、int64(BigInt64Array)
 * 支持 Fortran 序 2D 数组转置。
 * NPZ 用 fflate 的 unzipSync 一次性解压。
 */

export interface NpyHeader {
  descr: string;
  fortranOrder: boolean;
  shape: number[];
}

export interface NpyArray {
  descr: string;
  shape: number[];
  data: Float32Array | Float64Array | Int32Array | BigInt64Array;
}

export type NpzArchive = Record<string, NpyArray>;

function parseHeaderLiteral(headerStr: string): NpyHeader {
  const descrMatch = headerStr.match(/'descr'\s*:\s*'([^']+)'/);
  const fortranMatch = headerStr.match(/'fortran_order'\s*:\s*(True|False|'True'|'False')/);
  const shapeMatch = headerStr.match(/'shape'\s*:\s*\(([^)]*)\)/);

  if (!descrMatch || !shapeMatch) {
    throw new Error(`Invalid NPY header: ${headerStr}`);
  }

  const shapeParts = shapeMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);

  return {
    descr: descrMatch[1],
    fortranOrder: fortranMatch?.[1] === 'True' || fortranMatch?.[1] === "'True'",
    shape: shapeParts.length ? shapeParts : [1],
  };
}

/** 读取 float16：优先用 DataView.getFloat16（新浏览器），否则手动解码。 */
function readFloat16(view: DataView, byteOffset: number, littleEndian: boolean): number {
  const viewWithFloat16 = view as DataView & {
    getFloat16?: (offset: number, le?: boolean) => number;
  };
  if (typeof viewWithFloat16.getFloat16 === 'function') {
    return viewWithFloat16.getFloat16(byteOffset, littleEndian);
  }

  const bits = view.getUint16(byteOffset, littleEndian);
  const sign = (bits & 0x8000) >> 15;
  const exponent = (bits & 0x7c00) >> 10;
  const fraction = bits & 0x03ff;

  if (exponent === 0) {
    if (fraction === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * 2 ** -14 * (fraction / 1024);
  }
  if (exponent === 0x1f) {
    return fraction ? NaN : sign ? -Infinity : Infinity;
  }
  return (sign ? -1 : 1) * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function typedArrayFromDescr(
  descr: string,
): typeof Float32Array | typeof Float64Array | typeof BigInt64Array | typeof Int32Array | null {
  switch (descr) {
    case '<f4':
    case '>f4':
      return Float32Array;
    case '<f8':
    case '>f8':
      return Float64Array;
    case '<i8':
    case '>i8':
      return BigInt64Array;
    case '<i4':
    case '>i4':
      return Int32Array;
    default:
      return null;
  }
}

function elementSize(descr: string): number {
  if (descr.endsWith('2')) return 2;
  if (descr.endsWith('4')) return 4;
  if (descr.endsWith('8')) return 8;
  throw new Error(`Unsupported dtype size: ${descr}`);
}

function readArrayBuffer(
  buffer: ArrayBuffer,
  descr: string,
  littleEndian: boolean,
  numElements: number,
): NpyArray['data'] {
  const TypedArray = typedArrayFromDescr(descr);
  if (TypedArray) {
    if ((descr.startsWith('<') && littleEndian) || (descr.startsWith('>') && !littleEndian)) {
      return new TypedArray(buffer, 0, numElements);
    }

    const copy = new Uint8Array(buffer);
    if (descr.startsWith('>')) copy.reverse();
    return new TypedArray(copy.buffer, 0, numElements);
  }

  if (descr !== '<f2' && descr !== '>f2') {
    throw new Error(`Unsupported dtype: ${descr}`);
  }

  const f32 = new Float32Array(numElements);
  const view = new DataView(buffer);
  const le = descr === '<f2';
  for (let i = 0; i < numElements; i++) {
    f32[i] = readFloat16(view, i * 2, le);
  }
  return f32;
}

export function parseNpy(input: ArrayBuffer | Uint8Array): NpyArray {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\x93NUMPY') {
    throw new Error('Not a valid NPY file');
  }

  const major = bytes[6];
  let headerLen: number;
  let dataOffset: number;

  if (major === 1) {
    headerLen = bytes[8] | (bytes[9] << 8);
    dataOffset = 10 + headerLen;
  } else if (major === 2) {
    headerLen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    dataOffset = 12 + headerLen;
  } else {
    throw new Error(`Unsupported NPY version: ${major}`);
  }

  const headerStr = new TextDecoder('ascii').decode(
    bytes.slice(major === 1 ? 10 : 12, dataOffset),
  );
  const { descr, fortranOrder, shape } = parseHeaderLiteral(headerStr);

  const count = shape.reduce((acc, dim) => acc * dim, 1);
  const dataBytes = bytes.slice(dataOffset, dataOffset + count * elementSize(descr));
  let data = readArrayBuffer(dataBytes.buffer, descr, true, count);

  if (fortranOrder && shape.length === 2) {
    const [rows, cols] = shape;
    const reordered = new Float32Array(count);
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        reordered[row * cols + col] = Number(data[row + col * rows]);
      }
    }
    data = reordered;
  } else if (fortranOrder) {
    throw new Error(`Unsupported Fortran-order shape: ${shape.join('x')}`);
  }

  return { descr, shape, data };
}

/** 一次性解压 NPZ（标准 ZIP）并解析其中所有 .npy。 */
export async function parseNpz(arrayBuffer: ArrayBuffer): Promise<NpzArchive> {
  const { unzipSync } = await import('fflate');
  const archive = unzipSync(new Uint8Array(arrayBuffer));
  const result: NpzArchive = {};

  for (const [name, content] of Object.entries(archive)) {
    if (!name.endsWith('.npy')) continue;
    const key = name.slice(0, -4);
    result[key] = parseNpy(content);
  }

  return result;
}
