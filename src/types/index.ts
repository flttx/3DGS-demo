// 3D高斯数据结构
export interface GaussianData {
  // 位置数据 (x, y, z)
  positions: Float32Array;
  // 法线数据 (x, y, z)
  normals?: Float32Array;
  // 球谐函数系数 (SH) - 用于颜色计算
  f_dc: Float32Array;
  f_rest?: Float32Array;
  // 不透明度
  opacity: Float32Array;
  // 缩放 (log-space)
  scale: Float32Array;
  // 旋转 (四元数)
  rot: Float32Array;
}

// 相机参数
export interface CameraParams {
  fov: number;
  near: number;
  far: number;
  aspect: number;
}

// 3DGS渲染配置
export interface GSRenderConfig {
  maxGaussians: number;
  sortEnabled: boolean;
  useFSH: boolean;
  opacityThreshold: number;
  scaleModifier: number;
}
