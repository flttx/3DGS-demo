/**
 * 命令式创建 PlayCanvas Application
 * 端口自 awa-community-web/src/pages/3d-editor/lib/create-playcanvas-app.ts
 *
 * 直接 new Application(canvas) 而非通过 @playcanvas/react 的 <Application> 组件，
 * 便于在单一 useEffect 中完整控制生命周期，和 usePlayCanvasEditor 架构一致。
 */
import {
  Application,
  FILLMODE_FILL_WINDOW,
  GSPLAT_RENDERER_AUTO,
  RESOLUTION_AUTO,
} from 'playcanvas';

export function createApp(
  canvas: HTMLCanvasElement,
  antialias = false,
): Application {
  const app = new Application(canvas, {
    graphicsDeviceOptions: { antialias } as Record<string, unknown>,
  });

  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);

  // 对齐 awa-community-web 的默认场景设置
  app.scene.gsplat.renderer = GSPLAT_RENDERER_AUTO;
  app.scene.gsplat.alphaClip = 0.1;

  return app;
}
