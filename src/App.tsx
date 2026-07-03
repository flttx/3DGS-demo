import { useState } from 'react';
import GaussianSplatting from './components/GaussianSplatting';
import { GaussianData } from './types';

function App() {
  const [gaussianData] = useState<GaussianData | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 示例：加载 3DGS 文件
  const handleLoadGaussian = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // 这里需要替换为实际的 .ply 文件路径
      // const { loadGaussianSplatting } = await import('./utils/gsLoader');
      // const data = await loadGaussianSplatting('/path/to/your/model.ply');
      // setGaussianData(data);
      console.log('加载 3DGS 模型功能已准备好，请将模型文件放入 public 目录');
    } catch (err) {
      setError('加载模型失败: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <GaussianSplatting gaussianData={gaussianData} />
      
      {/* UI 覆盖层 */}
      <div className="ui-overlay">
        <h1>3DGS 学习项目</h1>
        <p>基于 React + PlayCanvas 的 3D 高斯溅射渲染</p>
        
        <div style={{ marginTop: '15px' }}>
          <button
            onClick={handleLoadGaussian}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              backgroundColor: isLoading ? '#666' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? '加载中...' : '加载 3DGS 模型'}
          </button>
        </div>
        
        {error && (
          <p style={{ color: '#ff6b6b', marginTop: '10px' }}>{error}</p>
        )}
        
        <div style={{ marginTop: '15px', fontSize: '0.8rem', opacity: 0.8 }}>
          <p>操作说明：</p>
          <ul style={{ marginLeft: '20px', marginTop: '5px' }}>
            <li>鼠标左键拖拽：旋转视角</li>
            <li>鼠标滚轮：缩放</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
