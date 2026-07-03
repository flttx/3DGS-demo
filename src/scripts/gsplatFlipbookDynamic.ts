/**
 * 逐帧播放脚本
 * 端口自 awa-community-web/src/pages/3d-editor/scripts/gsplat-flipbook-dynamic.ts
 *
 * 挂在带 gsplat 组件的实体上，按 fps 从 AnimationUnpacker 逐帧取 PLY，
 * 切换 entity.gsplat.asset。带预加载缓冲 + LRU Asset 缓存。
 */
import { Script, Asset, type AppBase } from 'playcanvas';
import { DEFAULT_ANIMATION_FPS, NORMAL_CACHE_MAX_ENTRIES, NORMAL_PRELOAD_COUNT } from '../lib/constants';
import type { FrameDescriptor } from './animationUnpacker';

export interface FrameProvider {
  getFrameDescriptor(frameIdx: number): FrameDescriptor;
  releaseFrameCache(frameIdx: number): void;
}

type PlayMode = 'loop' | 'bounce' | 'once';

interface CacheEntry {
  asset: Asset;
  refCount: number;
  lastUsed: number;
  frameIdx: number;
  app: AppBase;
}

interface PreloadedFrame {
  frameNum: number;
  cacheKey: string;
  asset: Asset;
}

class AssetCache {
  static cache = new Map<string, CacheEntry>();
  static maxEntries = NORMAL_CACHE_MAX_ENTRIES;

  static getAsset(descriptor: FrameDescriptor, app: AppBase): Asset {
    const { cacheKey, file } = descriptor;
    const entry = this.cache.get(cacheKey);
    if (entry && entry.app === app) {
      entry.refCount++;
      entry.lastUsed = performance.now();
      return entry.asset;
    }

    if (entry) {
      this.cache.delete(cacheKey);
    }

    const asset = new Asset(
      cacheKey,
      'gsplat',
      file as unknown as { url: string; filename: string; contents?: ArrayBuffer },
      { reorder: false },
    );
    app.assets.add(asset);
    app.assets.load(asset);
    this.cache.set(cacheKey, {
      asset,
      refCount: 1,
      lastUsed: performance.now(),
      frameIdx: descriptor.frameIdx,
      app,
    });
    return asset;
  }

  static releaseAsset(
    cacheKey: string,
    app: AppBase,
    onEvict?: (frameIdx: number) => void,
  ): void {
    const entry = this.cache.get(cacheKey);
    if (!entry || entry.app !== app) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) {
      this.evictStale(app, onEvict);
    }
  }

  static evictStale(app: AppBase, onEvict?: (frameIdx: number) => void): void {
    const evictable = [...this.cache.entries()]
      .filter(([, entry]) => entry.app === app && entry.refCount <= 0 && entry.asset.loaded)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    while (this.cache.size > this.maxEntries && evictable.length > 0) {
      const [cacheKey, entry] = evictable.shift()!;
      app.assets.remove(entry.asset);
      entry.asset.unload();
      this.cache.delete(cacheKey);
      onEvict?.(entry.frameIdx);
    }
  }

  static clear(app: AppBase, onEvict?: (frameIdx: number) => void): void {
    for (const [cacheKey, entry] of [...this.cache.entries()]) {
      if (entry.app !== app) continue;
      app.assets.remove(entry.asset);
      entry.asset.unload();
      onEvict?.(entry.frameIdx);
      this.cache.delete(cacheKey);
    }
  }

  static clearAll(onEvict?: (frameIdx: number) => void): void {
    for (const [, entry] of [...this.cache.entries()]) {
      try {
        entry.app.assets.remove(entry.asset);
        entry.asset.unload();
      } catch {
        // App may already be destroyed.
      }
      onEvict?.(entry.frameIdx);
      this.cache.delete(entry.asset.name);
    }
  }
}

/** 清空 flipbook 帧资产；销毁会话或切换资产前调用。 */
export function clearFlipbookAssetCache(app?: AppBase): void {
  if (app) {
    AssetCache.clear(app);
    return;
  }
  AssetCache.clearAll();
}

/**
 * 从内存中的 AnimationUnpacker 加载帧的 Flipbook 变体。
 */
export class GsplatFlipbookDynamic extends Script {
  static scriptName = 'gsplatFlipbookDynamic';

  fps = DEFAULT_ANIMATION_FPS;
  startFrame = 0;
  endFrame = 601;
  playMode: PlayMode = 'loop';
  playing = true;
  preloadCount = NORMAL_PRELOAD_COUNT;
  frameProvider: FrameProvider | null = null;
  onFrameChange: ((frame: number) => void) | null = null;

  currentFrame = 0;
  frameTime = 0;
  direction = 1;
  currentAsset: Asset | null = null;
  currentCacheKey: string | null = null;
  preloadedFrames: PreloadedFrame[] = [];
  /** 标记首帧是否已启动（initialize 同步执行时 frameProvider 尚未赋值，需延迟到 update）。 */
  private _booted = false;

  initialize(): void {
    this.currentFrame = this.startFrame;

    if (!this.entity.gsplat) {
      console.error('GsplatFlipbookDynamic: Entity must have a gsplat component with unified=true');
      return;
    }

    // frameProvider 可能晚于 create() 赋值（PlayCanvas 同步执行 initialize），
    // 此处不报错；改由 update() 在 frameProvider 就绪后启动首帧。
    if (this.frameProvider) {
      this._booted = true;
      this.loadFrame(this.currentFrame);
      this._notifyFrameChange();
    }
  }

  _notifyFrameChange(): void {
    this.onFrameChange?.(this.currentFrame);
  }

  _onEvict(frameIdx: number): void {
    this.frameProvider?.releaseFrameCache(frameIdx);
  }

  update(dt: number): void {
    // 延迟启动：frameProvider 就绪后才加载首帧
    if (!this._booted) {
      if (this.frameProvider) {
        this._booted = true;
        this.loadFrame(this.currentFrame);
        this._notifyFrameChange();
      }
      return;
    }

    if (!this.playing) return;

    this.frameTime += dt;
    if (this.frameTime >= 1 / this.fps) {
      this.frameTime = 0;
      if (this.preloadedFrames.length > 0 && this.preloadedFrames[0].asset.loaded) {
        this.switchToNextFrame();
      }
    }
  }

  switchToNextFrame(): void {
    const nextFrame = this.preloadedFrames.shift();
    if (!nextFrame) return;

    if (this.currentCacheKey) {
      AssetCache.releaseAsset(this.currentCacheKey, this.app, (frameIdx) =>
        this._onEvict(frameIdx),
      );
    }

    if (this.entity.gsplat) {
      this.entity.gsplat.asset = nextFrame.asset;
    }
    this.currentAsset = nextFrame.asset;
    this.currentCacheKey = nextFrame.cacheKey;

    this.advanceFrame();
    this.maintainPreloadBuffer();
    this._notifyFrameChange();
  }

  advanceFrame(): void {
    if (this.playMode === 'bounce') {
      this.currentFrame += this.direction;
      if (this.currentFrame >= this.endFrame) {
        this.currentFrame = this.endFrame;
        this.direction = -1;
      } else if (this.currentFrame <= this.startFrame) {
        this.currentFrame = this.startFrame;
        this.direction = 1;
      }
    } else if (this.playMode === 'loop') {
      this.currentFrame++;
      if (this.currentFrame > this.endFrame) {
        this.currentFrame = this.startFrame;
      }
    } else if (this.playMode === 'once') {
      this.currentFrame++;
      if (this.currentFrame >= this.endFrame) {
        this.currentFrame = this.endFrame;
        this.playing = false;
      }
    }
  }

  getNextFrameNumberFromLast(): number | null {
    if (this.preloadedFrames.length === 0) {
      return this.getNextFrameNumber();
    }

    const lastFrame = this.preloadedFrames[this.preloadedFrames.length - 1].frameNum;
    if (this.playMode === 'loop') {
      const next = lastFrame + 1;
      return next > this.endFrame ? this.startFrame : next;
    }
    if (this.playMode === 'once') {
      const next = lastFrame + 1;
      return next <= this.endFrame ? next : null;
    }
    return this.getNextFrameNumber();
  }

  getNextFrameNumber(): number | null {
    if (this.playMode === 'bounce') {
      return this.currentFrame + this.direction;
    }
    if (this.playMode === 'loop') {
      const next = this.currentFrame + 1;
      return next > this.endFrame ? this.startFrame : next;
    }
    if (this.playMode === 'once') {
      const next = this.currentFrame + 1;
      return next <= this.endFrame ? next : null;
    }
    return null;
  }

  maintainPreloadBuffer(): void {
    while (this.preloadedFrames.length < this.preloadCount) {
      const nextFrameNum = this.getNextFrameNumberFromLast();
      if (nextFrameNum === null) break;

      const descriptor = this.frameProvider!.getFrameDescriptor(nextFrameNum);
      const asset = AssetCache.getAsset(descriptor, this.app);
      this.preloadedFrames.push({
        frameNum: nextFrameNum,
        cacheKey: descriptor.cacheKey,
        asset,
      });
    }
  }

  loadFrame(frameNum: number): void {
    if (this.currentCacheKey) {
      AssetCache.releaseAsset(this.currentCacheKey, this.app, (frameIdx) =>
        this._onEvict(frameIdx),
      );
      this.currentCacheKey = null;
      this.currentAsset = null;
    }

    for (const frame of this.preloadedFrames) {
      AssetCache.releaseAsset(frame.cacheKey, this.app, (frameIdx) => this._onEvict(frameIdx));
    }
    this.preloadedFrames = [];

    const descriptor = this.frameProvider!.getFrameDescriptor(frameNum);
    const asset = AssetCache.getAsset(descriptor, this.app);

    this.currentCacheKey = descriptor.cacheKey;
    this.currentAsset = asset;

    const applyAsset = () => {
      if (this.entity.gsplat) {
        this.entity.gsplat.asset = asset;
      }
      this.maintainPreloadBuffer();
    };

    if (asset.loaded) {
      applyAsset();
    } else {
      asset.once('load', applyAsset);
      asset.once('error', (err: Error) => {
        console.error(`Frame ${frameNum} load failed`, err);
      });
    }
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.currentFrame = this.startFrame;
    this.direction = 1;
    this.frameTime = 0;
    this.loadFrame(this.currentFrame);
    this._notifyFrameChange();
  }

  seekToFrame(frameNum: number): void {
    if (frameNum < this.startFrame || frameNum > this.endFrame) {
      console.warn(
        `Frame ${frameNum} is out of range [${this.startFrame}, ${this.endFrame}]`,
      );
      return;
    }

    this.currentFrame = frameNum;
    this.frameTime = 0;
    this.loadFrame(this.currentFrame);
    this._notifyFrameChange();
  }

  onDestroy(): void {
    if (this.currentCacheKey) {
      AssetCache.releaseAsset(this.currentCacheKey, this.app, (frameIdx) =>
        this._onEvict(frameIdx),
      );
    }
    for (const frame of this.preloadedFrames) {
      AssetCache.releaseAsset(frame.cacheKey, this.app, (frameIdx) => this._onEvict(frameIdx));
    }
    this.preloadedFrames = [];
    AssetCache.clear(this.app, (frameIdx) => this._onEvict(frameIdx));
  }
}
