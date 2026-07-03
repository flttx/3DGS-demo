# 3DGS 学习项目

基于 React + PlayCanvas 的 3D 高斯溅射（Gaussian Splatting）学习项目。

## 项目结构

```
3DGS-demo/
├── src/
│   ├── hooks/
│   │   └── useOrbitCamera.ts       # 轨道相机控制 Hook
│   ├── App.tsx                     # 主应用组件（含场景、GSplat 渲染）
│   ├── main.tsx                    # 应用入口
│   └── index.css                   # 全局样式
├── public/                         # 公共资源（存放 3DGS 模型文件）
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000 查看项目。

### 构建生产版本

```bash
pnpm build
```

## 使用说明

### 添加 3DGS 模型

1. 将你的 `.ply` 格式 3DGS 模型文件放入 `public/` 目录
2. 在 `src/App.tsx` 中修改 `DEFAULT_MODEL_PATH` 为你的模型文件名
3. 点击 UI 中的「加载 3DGS 模型」按钮

### 操作说明

- **鼠标左键拖拽**：旋转视角
- **鼠标滚轮**：缩放

## 技术栈

- React 18 + TypeScript
- Vite
- PlayCanvas 2.x（内置 gsplat 渲染系统）
- @playcanvas/react（声明式 React 组件封装）

## 架构说明

本项目使用 PlayCanvas 引擎内置的 gsplat 系统进行 3DGS 渲染：

1. **资产加载**：通过 `@playcanvas/react` 的 `useSplat()` hook 加载 `.ply` 文件
   - 底层使用 PlayCanvas 的 `GSplatHandler` → `PlyParser` 进行解析
   - 支持标准 PLY、压缩 PLY、球谐函数（SH）数据
2. **渲染**：通过 `@playcanvas/react` 的 `<GSplat>` 组件渲染高斯溅射
   - 底层使用 PlayCanvas 的 `GSplatComponent`，包含完整的统一渲染管线
   - 支持 LOD、视图相关排序、EWA 投影、alpha 混合
3. **相机控制**：自定义 `useOrbitCamera` hook 提供轨道相机交互
4. **声明式组件**：使用 `@playcanvas/react` 的 `<Application>`、`<Entity>`、`<Camera>` 组件

## 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `playcanvas` | ^2.20.0 | PlayCanvas 3D 引擎，内置 gsplat 支持 |
| `@playcanvas/react` | ^0.11.5 | PlayCanvas 的 React 声明式封装 |
| `react` / `react-dom` | ^18.3.1 | UI 框架 |

## 开发说明

本项目为学习项目，核心实现：

1. **声明式场景构建**：使用 `@playcanvas/react` 组件树构建 3D 场景
2. **轨道相机控制**：`useOrbitCamera` hook 基于 PlayCanvas 鼠标事件系统
3. **3DGS 模型加载**：通过 PlayCanvas 内置 asset pipeline 加载和渲染 `.ply` 格式模型
4. **基础 UI**：使用 React 状态管理加载进度和错误提示
