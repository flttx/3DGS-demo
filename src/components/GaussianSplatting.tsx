import { useEffect, useRef, useState } from 'react';
import * as pc from 'playcanvas';
import { initPlayCanvasApp, setupScene } from '../utils/playcanvas';
import { GaussianData } from '../types';

interface GaussianSplattingProps {
  gaussianData?: GaussianData;
}

export default function GaussianSplatting({ gaussianData }: GaussianSplattingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<pc.Application | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;

    // 初始化 PlayCanvas 应用
    const app = initPlayCanvasApp(canvasRef.current);
    appRef.current = app;

    // 设置基础场景
    setupScene(app);

    // 添加示例几何体（临时，用于测试）
    addTestGeometry(app);

    // 启动应用
    app.start();

    setLoading(false);

    return () => {
      app.destroy();
    };
  }, []);

  useEffect(() => {
    if (!appRef.current || !gaussianData) return;

    // 这里将添加真实的 3DGS 渲染逻辑
    console.log('Gaussian data loaded:', gaussianData);
  }, [gaussianData]);

  return (
    <div className="canvas-container">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: '1.2rem'
        }}>
          初始化场景中...
        </div>
      )}
    </div>
  );
}

/**
 * 添加测试几何体
 * @param app PlayCanvas 应用实例
 */
function addTestGeometry(app: pc.Application): void {
  // 创建一个盒子作为示例
  const box = new pc.Entity();
  box.addComponent('model', {
    type: 'box'
  });
  box.setPosition(0, 0, 0);
  app.root.addChild(box);

  // 创建材质
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0.2, 0.4, 0.8);
  material.update();
  if (box.model && box.model.meshInstances) {
    box.model.meshInstances[0].material = material;
  }

  // 添加旋转动画
  let time = 0;
  app.on('update', (dt: number) => {
    time += dt;
    box.setEulerAngles(time * 20, time * 30, 0);
  });
}
