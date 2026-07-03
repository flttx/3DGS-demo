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
  const asset = new Asset(name, 'gsplat', { url }, { reorder: false });
  app.assets.add(asset);

  await new Promise<void>((resolve, reject) => {
    if (asset.loaded) { resolve(); return; }
    asset.once('load', () => resolve());
    asset.once('error', (err?: Error) => reject(err ?? new Error(`${name} 加载失败`)));
    app.assets.load(asset);
  });

  const entity = new Entity(name);
  entity.addComponent('gsplat', { unified: true });
  entity.gsplat!.asset = asset;
  app.root.addChild(entity);

  // 等待 gsplat resource 建立
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('场景 SOG resource 超时')), 120000);
    const check = () => {
      if (entity.gsplat?.resource) { clearTimeout(timeout); resolve(); return; }
      requestAnimationFrame(check);
    };
    check();
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
    const timeout = setTimeout(
      () => reject(new Error('首帧生成超时，请检查 NPZ / PLY 是否正确')),
      120000,
    );

    const check = () => {
      if (disposedRef.current) {
        clearTimeout(timeout);
        reject(new Error('组件已卸载'));
        return;
      }
      if (player.gsplat?.resource) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      const asset = flipbook.currentAsset;
      if (asset?.loaded && !player.gsplat?.resource) {
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
  const [state, setState] = useState<DemoState>({
    loading: false,
    ready: false,
    error: null,
    message: '',
    frame: 0,
    endFrame: 0,
  });

  const flipbookRef = useRef<FlipbookScript | null>(null);
  const disposedRef = useRef(false);

  // 暴露给 UI 的帧控制
  const togglePlay = useCallback(() => {
    const fb = flipbookRef.current;
    if (!fb) return;
    if (fb.playing) fb.pause(); else fb.play();
    setState(prev => ({ ...prev })); // 触发重渲染以刷新按钮状态
  }, []);

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
      clearColor: [0.05, 0.07, 0.12, 1],
      farClip: 1000,
      fov: 60,
    });
    camera.addComponent('script');
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
