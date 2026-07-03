import { useCallback, useEffect, useRef } from 'react';
import * as pc from 'playcanvas';

export interface OrbitControls {
  setTarget: (v: pc.Vec3) => void;
  setView: (yaw: number, pitch: number, distance: number) => void;
}

/**
 * 自定义 Hook：轨道相机控制
 * 使用 PlayCanvas 的 mouse 事件实现鼠标拖拽旋转和滚轮缩放。
 * 返回 controlsRef，外部可调用 setTarget/setView 重新对齐视角。
 *
 * @param cameraRef - PlayCanvas 相机实体的 ref
 * @param app - PlayCanvas 应用实例（通过 useApp() 获取）
 */
export function useOrbitCamera(
  cameraRef: React.RefObject<pc.Entity | null>,
  app: pc.Application | null
): React.RefObject<OrbitControls | null> {
  const stateRef = useRef({
    isDragging: false,
    lastX: 0,
    lastY: 0,
    distance: 10,
    yaw: 0,
    pitch: 15,
    target: new pc.Vec3(0, 0, 0),
  });

  const controlsRef = useRef<OrbitControls | null>(null);

  /** 根据 yaw/pitch/distance 更新相机位置（依赖 cameraRef.current） */
  const updateCameraPosition = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const state = stateRef.current;

    const yawRad = state.yaw * pc.math.DEG_TO_RAD;
    const pitchRad = state.pitch * pc.math.DEG_TO_RAD;

    const x = state.distance * Math.sin(yawRad) * Math.cos(pitchRad);
    const y = state.distance * Math.sin(pitchRad);
    const z = state.distance * Math.cos(yawRad) * Math.cos(pitchRad);

    cam.setPosition(
      state.target.x + x,
      state.target.y + y,
      state.target.z + z
    );
    cam.lookAt(state.target);
  }, [cameraRef]);

  // 暴露命令式控制接口（每帧覆盖属性，保证始终指向最新闭包）
  controlsRef.current = {
    setTarget: (v: pc.Vec3) => {
      stateRef.current.target.set(v.x, v.y, v.z);
      updateCameraPosition();
    },
    setView: (yaw: number, pitch: number, distance: number) => {
      stateRef.current.yaw = yaw;
      stateRef.current.pitch = Math.max(-85, Math.min(85, pitch));
      stateRef.current.distance = Math.max(0.1, Math.min(500, distance));
      updateCameraPosition();
    },
  };

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !app || !app.mouse) return;

    const state = stateRef.current;
    const { mouse } = app;

    const handleMouseDown = (e: pc.MouseEvent) => {
      if (e.button === pc.MOUSEBUTTON_LEFT) {
        state.isDragging = true;
        state.lastX = e.x;
        state.lastY = e.y;
      }
    };

    const handleMouseMove = (e: pc.MouseEvent) => {
      if (!state.isDragging) return;
      const dx = e.x - state.lastX;
      const dy = e.y - state.lastY;
      state.yaw -= dx * 0.2;
      state.pitch -= dy * 0.2;
      state.pitch = Math.max(-85, Math.min(85, state.pitch));
      state.lastX = e.x;
      state.lastY = e.y;
      updateCameraPosition();
    };

    const handleMouseUp = () => {
      state.isDragging = false;
    };

    const handleMouseWheel = (e: pc.MouseEvent) => {
      const wheelEvent = e.event as WheelEvent;
      state.distance += wheelEvent.deltaY * 0.02;
      state.distance = Math.max(0.1, Math.min(500, state.distance));
      updateCameraPosition();
    };

    mouse.on(pc.EVENT_MOUSEDOWN, handleMouseDown);
    mouse.on(pc.EVENT_MOUSEMOVE, handleMouseMove);
    mouse.on(pc.EVENT_MOUSEUP, handleMouseUp);
    mouse.on(pc.EVENT_MOUSEWHEEL, handleMouseWheel);

    updateCameraPosition();

    return () => {
      mouse.off(pc.EVENT_MOUSEDOWN, handleMouseDown);
      mouse.off(pc.EVENT_MOUSEMOVE, handleMouseMove);
      mouse.off(pc.EVENT_MOUSEUP, handleMouseUp);
      mouse.off(pc.EVENT_MOUSEWHEEL, handleMouseWheel);
    };
  }, [cameraRef, app, updateCameraPosition]);

  return controlsRef;
}
