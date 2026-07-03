/**
 * 3DGS 演示项目常量
 * 端口自 awa-community-web 的 constants.ts，仅保留本 demo 需要的部分
 */

/** 动画起止帧 */
export const START_FRAME = 0;

/** 动画默认播放帧率 */
export const DEFAULT_ANIMATION_FPS = 30;

/** 逐帧 PLY 的预加载帧数（前向缓冲） */
export const NORMAL_PRELOAD_COUNT = 3;

/** 帧字节缓存上限（LRU） */
export const NORMAL_CACHE_MAX_ENTRIES = 30;

/** 本地 3DGS 资产路径（public/ 目录，vite dev 下直接 serve） */
export const ASSET_URLS = {
  /** 动画基底 PLY 模板（含颜色/缩放/不透明度/SH 等静态属性） */
  basePly: '/base_perfect.ply',
  /** 动画轨迹 NPZ（逐帧 positions / rotations / shape） */
  npz: '/animation_track.npz',
  /** 静态背景场景 SOG */
  sceneSog: '/bedroom.sog',
} as const;

/** 动画角色相对场景中心的放置偏移（世界空间，米） */
export const ANIMATION_MODEL_OFFSET = {
  x: -1.5, // 向左
  y: -3, // 向下
  z: 1.5, // 向前（进入场景，-Z）
} as const;

/** 初始相机位置（世界空间，z 越大越靠后） */
export const INITIAL_CAMERA_POSITION = {
  x: -0.4,
  y: 1.3,
  z: 3,
} as const;

/** 初始相机焦点相对场景中心的偏移（世界空间） */
export const INITIAL_CAMERA_FOCUS_OFFSET = {
  x: 0,
  y: -4, // 焦点下移 → 相机俯视
  z: -4,
} as const;

/** 正常质量下的 gsplat alpha 裁剪阈值 */
export const NORMAL_ALPHA_CLIP = 0.1;
