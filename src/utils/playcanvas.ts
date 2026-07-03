import * as pc from 'playcanvas';

/**
 * 初始化 PlayCanvas 应用
 * @param canvas Canvas 元素
 * @returns PlayCanvas 应用实例
 */
export function initPlayCanvasApp(canvas: HTMLCanvasElement): pc.Application {
  // 创建图形设备
  const app = new pc.Application(canvas);

  // 设置画布大小
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);

  // 处理窗口大小变化
  window.addEventListener('resize', () => {
    app.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
  });

  return app;
}

/**
 * 创建 3D 场景基础设置
 * @param app PlayCanvas 应用实例
 */
export function setupScene(app: pc.Application): void {
  // 创建相机实体
  const camera = new pc.Entity();
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.1, 0.1, 0.1),
    farClip: 100,
    nearClip: 0.1
  });
  camera.setPosition(0, 0, 5);
  app.root.addChild(camera);

  // 添加轨道相机控制
  addOrbitCamera(camera, app);

  // 创建光源
  const light = new pc.Entity();
  light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 1, 1),
    intensity: 1,
    castShadows: false
  });
  light.setEulerAngles(45, 45, 0);
  app.root.addChild(light);

  // 设置环境光
  app.scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);
}

/**
 * 添加轨道相机控制
 * @param camera 相机实体
 * @param app PlayCanvas 应用实例
 */
function addOrbitCamera(camera: pc.Entity, app: pc.Application): void {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let distance = 5;
  let yaw = 0;
  let pitch = 0;
  let target = new pc.Vec3(0, 0, 0);

  const { mouse } = app;
  if (!mouse) return;

  // 鼠标事件
  mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
    if (e.button === pc.MOUSEBUTTON_LEFT) {
      isDragging = true;
      lastX = e.x;
      lastY = e.y;
    }
  });

  mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
    if (isDragging) {
      const dx = e.x - lastX;
      const dy = e.y - lastY;
      yaw -= dx * 0.2;
      pitch -= dy * 0.2;
      pitch = Math.max(-85, Math.min(85, pitch));
      lastX = e.x;
      lastY = e.y;
      updateCameraPosition();
    }
  });

  mouse.on(pc.EVENT_MOUSEUP, () => {
    isDragging = false;
  });

  mouse.on(pc.EVENT_MOUSEWHEEL, (e) => {
    // 使用 deltaY 代替 wheel
    distance += (e as any).deltaY * 0.01;
    distance = Math.max(0.5, Math.min(50, distance));
    updateCameraPosition();
  });

  function updateCameraPosition(): void {
    const yawRad = yaw * pc.math.DEG_TO_RAD;
    const pitchRad = pitch * pc.math.DEG_TO_RAD;

    const x = distance * Math.sin(yawRad) * Math.cos(pitchRad);
    const y = distance * Math.sin(pitchRad);
    const z = distance * Math.cos(yawRad) * Math.cos(pitchRad);

    camera.setPosition(target.x + x, target.y + y, target.z + z);
    camera.lookAt(target);
  }

  updateCameraPosition();
}
