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

  // 动画的默认帧率
  fps = DEFAULT_ANIMATION_FPS;
  // 动画起始帧索引
  startFrame = 0;
  // 动画结束帧索引
  endFrame = 601;
  // 播放模式：'loop' (循环), 'bounce' (往复), 'once' (单次)
  playMode: PlayMode = 'loop';
  // 是否正在播放
  playing = true;
  // 预加载的帧数，用于保证播放流畅度
  preloadCount = NORMAL_PRELOAD_COUNT;
  // 帧数据提供者，负责解析和提供具体每一帧的数据
  frameProvider: FrameProvider | null = null;
  // 帧变化时的回调函数，通常用于通知外部更新 UI（如进度条等）
  onFrameChange: ((frame: number) => void) | null = null;

  // 当前正在显示的帧索引
  currentFrame = 0;
  // 累计的帧时间，用于判断是否达到下一帧的切换时间
  frameTime = 0;
  // 播放方向（1为正向，-1为反向），主要用于 'bounce' 模式
  direction = 1;
  // 当前正在渲染的 3DGS 资产
  currentAsset: Asset | null = null;
  // 当前资产在缓存中的 Key
  currentCacheKey: string | null = null;
  // 预加载队列，存放已经或正在加载的后续帧资产信息
  preloadedFrames: PreloadedFrame[] = [];
  /** 标记首帧是否已启动（initialize 同步执行时 frameProvider 尚未赋值，需延迟到 update）。 */
  private _booted = false;

  // 脚本初始化生命周期函数
  initialize(): void {
    this.currentFrame = this.startFrame;

    // 确保当前实体上挂载了 gsplat 组件，且启用了 unified 渲染路径
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

  // 触发帧变化回调事件
  _notifyFrameChange(): void {
    this.onFrameChange?.(this.currentFrame);
  }

  // 缓存淘汰回调：当缓存中不再需要某一帧时，通知 frameProvider 释放底层数据（如解压的 Buffer）
  _onEvict(frameIdx: number): void {
    this.frameProvider?.releaseFrameCache(frameIdx);
  }

  // 引擎每帧调用的更新函数，驱动动画播放的核心机制
  update(dt: number): void {
    // 延迟启动：frameProvider 就绪后才真正加载第一帧
    if (!this._booted) {
      if (this.frameProvider) {
        this._booted = true;
        this.loadFrame(this.currentFrame);
        this._notifyFrameChange();
      }
      return;
    }

    // 如果处于暂停状态，则不继续执行帧累加
    if (!this.playing) return;

    // 累加两帧之间的时间差 dt
    this.frameTime += dt;
    // 如果累计时间达到了当前设定的 fps 对应的帧间距（即 1 / fps）
    if (this.frameTime >= 1 / this.fps) {
      this.frameTime = 0; // 重置累计时间
      // 检查预加载队列：如果队列里有准备好的帧，且这帧资源的 WebGL 资产已经上传（loaded）完成，则切换过去
      if (this.preloadedFrames.length > 0 && this.preloadedFrames[0].asset.loaded) {
        this.switchToNextFrame();
      }
    }
  }

  // 切换到下一帧的核心逻辑
  switchToNextFrame(): void {
    // 从预加载队列中取出第一帧
    const nextFrame = this.preloadedFrames.shift();
    if (!nextFrame) return;

    // 释放当前正在渲染的帧资源（即告诉缓存管理器减少对这个资产的引用）
    if (this.currentCacheKey) {
      AssetCache.releaseAsset(this.currentCacheKey, this.app, (frameIdx) =>
        this._onEvict(frameIdx),
      );
    }

    // 将预加载拿到的新资产赋值给 gsplat 组件，从而在画面上呈现新的帧
    if (this.entity.gsplat) {
      this.entity.gsplat.asset = nextFrame.asset;
    }
    // 记录为当前的资产和缓存 Key
    this.currentAsset = nextFrame.asset;
    this.currentCacheKey = nextFrame.cacheKey;

    // 根据播放模式计算真正的“下一帧”应该是什么索引
    this.advanceFrame();
    // 触发后台预加载，补齐刚才被消耗掉的缓冲帧
    this.maintainPreloadBuffer();
    // 广播帧号已改变的事件
    this._notifyFrameChange();
  }

  // 根据当前的播放模式（循环/单次/往返），更新 currentFrame 和播放方向 direction
  advanceFrame(): void {
    if (this.playMode === 'bounce') {
      // 往复播放模式：到达终点或起点时反向
      this.currentFrame += this.direction;
      if (this.currentFrame >= this.endFrame) {
        this.currentFrame = this.endFrame;
        this.direction = -1; // 到达结尾，反向播放
      } else if (this.currentFrame <= this.startFrame) {
        this.currentFrame = this.startFrame;
        this.direction = 1; // 回到开头，正向播放
      }
    } else if (this.playMode === 'loop') {
      // 循环播放模式：达到结尾即返回起点
      this.currentFrame++;
      if (this.currentFrame > this.endFrame) {
        this.currentFrame = this.startFrame;
      }
    } else if (this.playMode === 'once') {
      // 单次播放模式：到达结尾则停止播放
      this.currentFrame++;
      if (this.currentFrame >= this.endFrame) {
        this.currentFrame = this.endFrame;
        this.playing = false; // 自动停止
      }
    }
  }

  // 推算预加载队列“尾部”之后应该加载的下一帧编号
  getNextFrameNumberFromLast(): number | null {
    // 如果预加载队列为空，说明从当前帧推算
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
      return next <= this.endFrame ? next : null; // 超过结束帧就不再预加载了
    }
    return this.getNextFrameNumber(); // 复杂模式退回到默认推断
  }

  // 根据当前正在播放的帧，推算下一次在画面上应该显示的帧编号
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

  // 维持预加载缓冲区长度，不断请求资产直至达到 preloadCount 指定的数量
  maintainPreloadBuffer(): void {
    while (this.preloadedFrames.length < this.preloadCount) {
      const nextFrameNum = this.getNextFrameNumberFromLast();
      if (nextFrameNum === null) break; // 若无需预加载，则退出循环

      // 获取该帧的底层数据描述符
      const descriptor = this.frameProvider!.getFrameDescriptor(nextFrameNum);
      // 向资产缓存池请求对应资产（如未加载则发起加载流程，如已加载则直接增加引用计数）
      const asset = AssetCache.getAsset(descriptor, this.app);
      
      // 推入预加载队列进行排队
      this.preloadedFrames.push({
        frameNum: nextFrameNum,
        cacheKey: descriptor.cacheKey,
        asset,
      });
    }
  }

  // 强制加载并显示指定帧（常用于组件初始化、用户拖动进度条、或重置播放时）
  loadFrame(frameNum: number): void {
    // 放弃正在显示的资产
    if (this.currentCacheKey) {
      AssetCache.releaseAsset(this.currentCacheKey, this.app, (frameIdx) =>
        this._onEvict(frameIdx),
      );
      this.currentCacheKey = null;
      this.currentAsset = null;
    }

    // 清空现有预加载队列中的资产，全部释放引用
    for (const frame of this.preloadedFrames) {
      AssetCache.releaseAsset(frame.cacheKey, this.app, (frameIdx) => this._onEvict(frameIdx));
    }
    this.preloadedFrames = [];

    // 请求新帧的数据和资产
    const descriptor = this.frameProvider!.getFrameDescriptor(frameNum);
    const asset = AssetCache.getAsset(descriptor, this.app);

    this.currentCacheKey = descriptor.cacheKey;
    this.currentAsset = asset;

    // 当资产 ready 后如何将其应用到实体的回调
    const applyAsset = () => {
      if (this.entity.gsplat) {
        this.entity.gsplat.asset = asset;
      }
      // 成功展示后，马上触发后台的继续预加载
      this.maintainPreloadBuffer();
    };

    if (asset.loaded) {
      // 已经在内存中了，立刻应用
      applyAsset();
    } else {
      // 等待加载完成后再应用
      asset.once('load', applyAsset);
      asset.once('error', (err: Error) => {
        console.error(`Frame ${frameNum} load failed`, err);
      });
    }
  }

  // 恢复播放
  play(): void {
    this.playing = true;
  }

  // 暂停播放
  pause(): void {
    this.playing = false;
  }

  // 停止播放：重置为起始状态
  stop(): void {
    this.playing = false;
    this.currentFrame = this.startFrame;
    this.direction = 1;
    this.frameTime = 0;
    this.loadFrame(this.currentFrame);
    this._notifyFrameChange();
  }

  // 定位到指定帧
  seekToFrame(frameNum: number): void {
    if (frameNum < this.startFrame || frameNum > this.endFrame) {
      console.warn(
        `Frame ${frameNum} is out of range [${this.startFrame}, ${this.endFrame}]`,
      );
      return;
    }

    this.currentFrame = frameNum;
    this.frameTime = 0; // 重置计时器，从这刻重新累加
    this.loadFrame(this.currentFrame); // 强制重新加载这一帧及其预加载缓存
    this._notifyFrameChange();
  }

  // 组件销毁时的清理逻辑：避免显存和内存的长期泄漏
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
    
    // 通知资产缓存清理所有因为本 app 而保留的游离资源
    AssetCache.clear(this.app, (frameIdx) => this._onEvict(frameIdx));
  }
}
