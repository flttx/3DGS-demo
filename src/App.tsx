/**
 * 3DGS Demo — 主应用
 *
 * 架构对齐 awa-community-web/src/pages/3d-editor/hooks/usePlayCanvasEditor.ts：
 * - 命令式 createApp()，单一 useEffect bootstrap
 * - CameraControls 官方脚本（enableFly 漫游相机）
 * - 并行下载 PLY + NPZ + SOG，首帧就绪后定位相机
 * - 使用 public/ 本地资源
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  Asset,
  Entity,
  Vec3,
  type AppBase,
} from 'playcanvas';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { AnimationUnpacker } from './scripts/animationUnpacker';
import {
  GsplatFlipbookDynamic,
  clearFlipbookAssetCache,
  type GsplatFlipbookDynamic as FlipbookScript,
} from './scripts/gsplatFlipbookDynamic';
import { centerModelAt, getGsplatCenterWorld } from './lib/gsplatModelScale';
import { createApp } from './lib/createApp';
import {
  ANIMATION_MODEL_OFFSET,
  ASSET_URLS,
  INITIAL_CAMERA_FOCUS_OFFSET,
  INITIAL_CAMERA_POSITION,
  NORMAL_PRELOAD_COUNT,
  START_FRAME,
  DEFAULT_ANIMATION_FPS,
} from './lib/constants';

// ─── 类型 ────────────────────────────────────────────────────────────────────
type CameraControlsScript = InstanceType<typeof CameraControls>;

interface DemoState {
  loading: boolean;
  ready: boolean;
  error: string | null;
  message: string;
  frame: number;
  endFrame: number;
}

// ─── 辅助函数（对齐 usePlayCanvasEditor）───────────────────────────────────

/** 相机焦点 = 场景中心 + 俯视偏移 */
function offsetFocusFromCenter(center: Vec3, out = new Vec3()): Vec3 {
  out.set(
    center.x + INITIAL_CAMERA_FOCUS_OFFSET.x,
    center.y + INITIAL_CAMERA_FOCUS_OFFSET.y,
    center.z + INITIAL_CAMERA_FOCUS_OFFSET.z,
  );
  return out;
}

/** 以漫游模式运行 CameraControls（关闭轨道，开启 fly） */
function applyRoamCameraControls(cameraControls: CameraControlsScript): void {
  cameraControls.enableOrbit = false;
  cameraControls.enableFly = true;
  const focus = cameraControls.focusPoint;
  cameraControls.look(new Vec3(focus.x, focus.y, focus.z));
}

/** 同步漫游相机位置和焦点 */
function syncRoamCameraTransform(
  camera: Entity,
  cameraControls: CameraControlsScript,
  focus: Vec3,
  position: Vec3,
): void {
  camera.setPosition(position);
  camera.lookAt(focus);
  cameraControls.focusPoint = focus.clone();
  cameraControls.enableOrbit = false;
  cameraControls.enableFly = true;
}

/** 加载静态 GSplat 场景（SOG），等待 resource 就绪 */
async function loadStaticGsplat(app: AppBase, url: string, name: string): Promise<Entity> {
  // Asset用来管理所有外部数据加载和生命周期的核心载体
  // name: 资源的名称，通常用于在资源管理器中识别
  // type: 资源的类型，PlayCanvas 内部的加载系统（Registry）会根据这个类型来决定使用哪个具体的加载器（Loader）去解析数据。
  // url: 指向文件实际存放位置的网络地址或本地相对路径
  // options: { reorder: false } 表示禁用加载时的空间重排排序。
  // 【为什么要禁用？（3DGS与排序机制）】
  // 1. 半透明必须排序：3D 高斯球是半透明的，GPU 渲染半透明物体必须严格遵守“从后往前”的顺序，否则颜色混合会出错。
  // 2. 默认的空间重排代价：如果设为 true（默认），引擎在解析这几百万个球时，会用 CPU 执行昂贵的莫顿码（Morton Order）
  //    空间排序，把物理位置相近的球在内存中排到一起，以优化后续渲染，这会导致加载时间变得极长。
  // 3. 为什么 SOG 可以跳过：SOG（Scene Object Graph）文件或我们用于 flipbook 动画的特制 PLY，在打包生成时
  //    【已经在离线工具端预先做过空间优化排序了】。所以我们传个免检通行证 `reorder: false`，直接把内存
  //    原封不动丢给 GPU（配合 Compute Shader 实时排序），从而实现极速加载！
  const asset = new Asset(name, 'gsplat', { url }, { reorder: false });
  app.assets.add(asset);

  await new Promise<void>((resolve, reject) => {
    if (asset.loaded) { resolve(); return; }
    asset.once('load', () => resolve());
    asset.once('error', (err?: Error) => reject(err ?? new Error(`${name} 加载失败`)));
    app.assets.load(asset);
  });

  const entity = new Entity(name);
  //  添加一个 gsplat组件
  entity.addComponent('gsplat', { unified: true });
  // 给 gsplat 组件绑定 asset
  // 【为什么赋值后不能立刻拿到 resource？】
  // 1. 触发管线：等号左边的 `.asset` 是一个 Setter。赋值操作会通知 PlayCanvas 底层的 GSplat 系统（如 gsplat-manager）。
  // 2. 异步解析：底层引擎接管这批数据后，需要进行复杂的转换工作，例如把高斯球的位置、颜色、缩放等数据反序列化，
  //    将其打包并上传到 GPU 的 Buffer 中，有些系统下还要初始化 Compute Shader 用于排序。
  // 3. 跨帧流转：上述构建工作并非在一个同步的调用栈里完成，它会被丢进引擎的异步渲染队列里。
  //    通常需要等到下一帧或几帧之后的引擎内部生命周期流转到特定阶段时，`resource` 才会被真正实例化出来。
  entity.gsplat!.asset = asset;
  app.root.addChild(entity);

  // 等待 gsplat resource 建立
  // 【为什么要用 app.on('prerender') 替代 requestAnimationFrame?】
  // 1. 引擎生命周期对齐：requestAnimationFrame 是浏览器级别的，而 prerender 是 PlayCanvas 引擎内部
  //    渲染管线触发的事件。绑定在引擎渲染前去检查资源是否就绪，逻辑上更加严谨且不会产生多余的空转。
  // 2. 避免内存/CPU 泄露：如果我们使用 requestAnimationFrame，在触发超时 (timeout) reject 时，
  //    如果没有额外的标记位去手动打断递归，rAF 循环会永远在后台运行造成性能泄露；
  //    而使用 app.on('prerender')，我们可以借助 app.off() 在成功或超时时清晰且彻底地卸载监听器。
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (entity.gsplat?.resource) {
        app.off('prerender', check);
        clearTimeout(timeout);
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      app.off('prerender', check); // 异常/超时时取消监听
      reject(new Error('场景 SOG resource 超时'));
    }, 120000);

    app.on('prerender', check);
  });

  return entity;
}

/** 等待 flipbook 第一帧 resource 就绪 */
function waitForFirstFrame(
  player: Entity,
  flipbook: FlipbookScript,
  disposedRef: { current: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let isDone = false;

    const timeout = setTimeout(() => {
      isDone = true;
      reject(new Error('首帧生成超时，请检查 NPZ / PLY 是否正确'));
    }, 120000);

    const check = () => {
      if (isDone) return;

      if (disposedRef.current) {
        isDone = true;
        clearTimeout(timeout);
        reject(new Error('组件已卸载'));
        return;
      }
      if (player.gsplat?.resource) {
        isDone = true;
        clearTimeout(timeout);
        resolve();
        return;
      }
      const asset = flipbook.currentAsset;
      if (asset?.loaded && !player.gsplat?.resource) {
        isDone = true;
        clearTimeout(timeout);
        reject(new Error('首帧资源加载异常，请刷新页面重试'));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

// ─── 主 Hook ─────────────────────────────────────────────────────────────────

function usePlayCanvasScene(canvasRef: RefObject<HTMLCanvasElement | null>) {
  // 【React 驱动层状态 (State)】
  // 作用：这些状态主要用于驱动外部 UI 层的重新渲染。
  // 为什么不用 Ref？因为当加载进度、播放帧号或者报错发生变化时，我们需要 React 知道这些变化
  // 从而更新页面上的进度条、帧号数字和错误提示框。
  const [state, setState] = useState<DemoState>({
    loading: false,  // 是否正在执行并行下载和初始化管线
    ready: false,    // 首帧是否已经生成完毕并挂载到场景中
    error: null,     // 存储由 Promise catch 捕获到底层异常信息
    message: '',     // 供 UI 显示当前卡在哪个加载阶段的文案
    frame: 0,        // 当前正显示在屏幕上的动画帧序号（用于进度展示）
    endFrame: 0,     // 动画总共有多少帧
  });

  // 【PlayCanvas 实例透传 (Ref)】
  // 作用：保存底层引擎的动画控制脚本实例。
  // 为什么不用 State？因为引擎对象的读写频率极高（每秒 60 次更新），如果放在 state 里会导致 React 疯狂重渲染甚至崩溃。
  // 用 ref 既能保留引用，又能让 React 侧（比如外面的播放/暂停按钮）安全地调用它内部的 play() / pause() 方法。
  const flipbookRef = useRef<FlipbookScript | null>(null);

  // 【强制刷新器】
  // 作用：当 flipbookRef 内部的属性（如 playing）发生改变时，通知 React 重新渲染 UI。
  // 避免使用 setState(prev => ({ ...prev })) 这种深层浅拷贝带来的语义不明和额外微小开销。
  const [, forceUpdate] = useState(0);

  // 【防闭包泄露标识 (Ref)】
  // 作用：当 React 组件因为路由切换或 HMR (热更新) 被销毁时，PlayCanvas 的异步加载可能还在后台跑。
  // 如果后台加载完后执行 setState，就会报 "Can't perform a React state update on an unmounted component" 的经典内存泄露警告。
  // 因此我们在 useEffect 销毁时将其置为 true，所有的异步回调看到它为 true 都会立刻 return 停止执行。
  const disposedRef = useRef(false);

  // 暴露给 UI 的帧控制
  const togglePlay = useCallback(() => {
    const fb = flipbookRef.current;
    if (!fb) return;
    if (fb.playing) fb.pause(); else fb.play();
    forceUpdate(n => n + 1); // 触发重渲染以刷新按钮状态
  }, []);

  // 【按需加载控制开关】
  // 作用：配合外部的“加载场景”按钮，只有点击后变为 true 时，才会触发下面那个巨大的 useEffect 执行引擎初始化。
  // 避免了一进页面就自动猛跑高强度 WebGL 渲染，给用户手机或浏览器留出喘息和交互确认的空间。
  const [startLoad, setStartLoad] = useState(false);

  useEffect(() => {
    if (!startLoad) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    disposedRef.current = false;
    const abort = new AbortController();

    // ── 1. 初始化 Application（命令式，对齐 usePlayCanvasEditor）
    const app = createApp(canvas);
    app.start();

    const handleResize = () => app.resizeCanvas();
    window.addEventListener('resize', handleResize);

    // ── 2. 相机实体 + CameraControls 脚本
    const initialFocus = offsetFocusFromCenter(new Vec3(0, 0, 0));
    const camera = new Entity('Camera');
    camera.setPosition(
      INITIAL_CAMERA_POSITION.x,
      INITIAL_CAMERA_POSITION.y,
      INITIAL_CAMERA_POSITION.z,
    );
    camera.lookAt(initialFocus);
    camera.addComponent('camera', {
      // 屏幕背景清除色 [R, G, B, A]，取值 0~1。
      // 引擎默认值：[0.118, 0.118, 0.118, 1] (深灰色)。这里改为偏暗蓝的深色调，让高斯模型更凸显。
      clearColor: [0.05, 0.07, 0.12, 1],
      
      // 远裁剪面（Far Clip）：相机能看到的最远距离，超过这个距离的物体会被直接剔除（不渲染）。
      // 引擎默认值：1000。这里显式声明保持默认 1000。
      // (与之对应的是 nearClip 近裁剪面，引擎默认值 0.1，太近会被剖开裁剪)
      farClip: 1000,
      
      // 视场角（Field of View），默认指垂直方向张开的角度（单位：度）。
      // 引擎默认值：45 度。这里调大到 60 度，能带来更宽广的视野，减少画面局促感。
      fov: 60,
    });
    // 【为什么还要加个 script 组件？（ECS架构：数据与逻辑分离）】
    // 上面的 `camera` 组件只提供了“光学镜头”（纯数据），它根本不知道如何响应鼠标/键盘去移动。
    // PlayCanvas 的设计规范是：任何动态逻辑和输入监听，都必须作为单独的 Script 挂载。
    camera.addComponent('script');
    
    // 实例化官方的相机控制脚本（这是一个官方提供的扩展组件，用来处理鼠标拖拽旋转、滚轮缩放等交互）
    const cameraControls = camera.script!.create(CameraControls) as unknown as CameraControlsScript;
    if (cameraControls) {
      cameraControls.focusPoint = initialFocus.clone();
      cameraControls.rotateSpeed = 0.35;
      cameraControls.zoomSpeed = 0.002;
      applyRoamCameraControls(cameraControls);
    }
    app.root.addChild(camera);

    // ── 3. Bootstrap async（对齐 usePlayCanvasEditor.bootstrap）
    async function bootstrap() {
      clearFlipbookAssetCache(app);

      const unpacker = new AnimationUnpacker();

      try {
        setState(prev => ({ ...prev, loading: true, error: null, message: '正在并行下载场景与动画资源...' }));

        // 并行：解析 NPZ + 下载基底 PLY；同时加载场景 SOG
        const [, sceneEntity] = await Promise.all([
          unpacker.load({
            basePlyUrl: ASSET_URLS.basePly,
            npzUrl: ASSET_URLS.npz,
            signal: abort.signal,
            onProgress: (message) => {
              if (!disposedRef.current) {
                setState(prev => ({ ...prev, message }));
              }
            },
          }),
          loadStaticGsplat(app, ASSET_URLS.sceneSog, 'SceneGsplat'),
        ]);

        if (disposedRef.current) return;

        // SOG 场景绕 X 轴翻转 180°（坐标系对齐）
        sceneEntity.setLocalEulerAngles(180, 0, 0);

        const endFrame = unpacker.numFrames - 1;

        // ── 4. 创建动画角色实体 + flipbook 脚本（对齐原版）
        const player = new Entity('SplatAnimation');
        player.setLocalEulerAngles(180, 0, 0);
        player.addComponent('gsplat', { unified: true });
        player.addComponent('script');
        const flipbook = player.script!.create(GsplatFlipbookDynamic) as unknown as FlipbookScript;
        flipbookRef.current = flipbook;

        flipbook.frameProvider = unpacker;
        flipbook.fps = DEFAULT_ANIMATION_FPS;
        flipbook.startFrame = START_FRAME;
        flipbook.endFrame = endFrame;
        flipbook.playMode = 'loop';
        flipbook.playing = true;          // 对齐原版：在 waitForFirstFrame 前就 true
        flipbook.preloadCount = NORMAL_PRELOAD_COUNT;

        player.setLocalPosition(0, 0, 0);
        app.root.addChild(player);

        setState(prev => ({ ...prev, message: '正在生成并加载第一帧...', endFrame }));

        // ── 5. 等待首帧 resource 就绪
        await waitForFirstFrame(player, flipbook, disposedRef);
        if (disposedRef.current) return;

        // ── 6. 将动画角色居中到场景中心，施加偏移（对齐原版）
        const sceneCenter = new Vec3(0, 0, 0);
        getGsplatCenterWorld(sceneEntity, sceneCenter);
        centerModelAt(player, sceneCenter);
        const pos = player.getLocalPosition();
        player.setLocalPosition(
          pos.x + ANIMATION_MODEL_OFFSET.x,
          pos.y + ANIMATION_MODEL_OFFSET.y,
          pos.z + ANIMATION_MODEL_OFFSET.z,
        );

        // ── 7. 对齐相机到场景中心（对齐 syncRoamCameraTransform）
        if (cameraControls) {
          const focus = offsetFocusFromCenter(sceneCenter);
          syncRoamCameraTransform(
            camera,
            cameraControls,
            focus,
            new Vec3(
              INITIAL_CAMERA_POSITION.x,
              INITIAL_CAMERA_POSITION.y,
              INITIAL_CAMERA_POSITION.z,
            ),
          );
        }

        // ── 8. 帧变化回调（仅更新 UI 帧号）
        flipbook.onFrameChange = (frame: number) => {
          if (!disposedRef.current) {
            setState(prev => ({ ...prev, frame }));
          }
        };

        setState(prev => ({
          ...prev,
          loading: false,
          ready: true,
          frame: START_FRAME,
          endFrame,
          message: '',
        }));
      } catch (err) {
        if (disposedRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : '加载失败';
        console.error('[bootstrap] error:', err);
        setState(prev => ({ ...prev, loading: false, error: message }));
      }
    }

    bootstrap();

    // ── 清理
    return () => {
      disposedRef.current = true;
      abort.abort();
      window.removeEventListener('resize', handleResize);
      clearFlipbookAssetCache(app);
      flipbookRef.current = null;
      app.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLoad]);

  return { state, startLoad, setStartLoad, togglePlay, flipbookRef };
}

// ─── App 组件 ─────────────────────────────────────────────────────────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, startLoad, setStartLoad, togglePlay, flipbookRef } = usePlayCanvasScene(canvasRef);

  const handleLoad = () => {
    if (state.loading || state.ready) return;
    setStartLoad(true);
  };

  const isPlaying = flipbookRef.current?.playing ?? false;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0d0f14', overflow: 'hidden' }}>
      {/* PlayCanvas Canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* UI 覆盖层 */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        color: '#fff',
        fontFamily: '"Inter", "Noto Sans SC", sans-serif',
        userSelect: 'none',
        pointerEvents: 'none',
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>3DGS Demo</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.6 }}>React + PlayCanvas · 高斯溅射渲染</p>
      </div>

      {/* 控制面板 */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'auto',
      }}>
        {/* 状态消息 */}
        {state.loading && state.message && (
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            color: '#ffd',
            maxWidth: 400,
            textAlign: 'center',
          }}>
            ⏳ {state.message}
          </div>
        )}
        {state.error && (
          <div style={{
            background: 'rgba(180,30,30,0.85)',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            color: '#fff',
          }}>
            ❌ {state.error}
          </div>
        )}

        {/* 帧计数器 */}
        {state.ready && state.endFrame > 0 && (
          <div style={{
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 8,
            padding: '4px 14px',
            fontSize: 12,
            color: '#aef',
          }}>
            帧 {state.frame} / {state.endFrame}
          </div>
        )}

        {/* 按钮行 */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!startLoad && (
            <button
              onClick={handleLoad}
              style={btnStyle('#2a7a3b')}
            >
              🎬 加载场景
            </button>
          )}

          {state.ready && (
            <button
              onClick={togglePlay}
              style={btnStyle(isPlaying ? '#7a5a1a' : '#1a5a7a')}
            >
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
          )}
        </div>

        {/* 操作提示 */}
        {state.ready && (
          <div style={{ fontSize: 11, opacity: 0.5, color: '#fff', textAlign: 'center' }}>
            左键拖拽旋转 · 右键平移 · 滚轮缩放
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(bg: string): CSSProperties {
  return {
    padding: '9px 20px',
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: 0.5,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    transition: 'opacity 0.15s',
  };
}
