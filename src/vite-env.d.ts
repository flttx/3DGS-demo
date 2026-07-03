/// <reference types="vite/client" />

// 为 PlayCanvas 官方 CameraControls 脚本提供类型声明
// 端口自 awa-community-web/src/vite-env.d.ts
declare module 'playcanvas/scripts/esm/camera-controls.mjs' {
  import type { Script } from 'playcanvas';

  export class CameraControls extends Script {
    focusPoint: import('playcanvas').Vec3;
    rotateSpeed: number;
    zoomSpeed: number;
    enableOrbit: boolean;
    enableFly: boolean;
    enabled: boolean;
    reset(focus: import('playcanvas').Vec3, position: import('playcanvas').Vec3): void;
    look(focus: import('playcanvas').Vec3, resetZoom?: boolean): void;
  }
}
