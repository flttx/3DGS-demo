# 3DGS 学习项目

基于 React + PlayCanvas 的 3D 高斯溅射（Gaussian Splatting）学习项目。

## 项目结构

```
3DGS-demo/
├── src/
│   ├── components/
│   │   └── GaussianSplatting.tsx  # 3DGS 渲染组件
│   ├── types/
│   │   └── index.ts                # 类型定义
│   ├── utils/
│   │   ├── playcanvas.ts           # PlayCanvas 初始化工具
│   │   └── gsLoader.ts             # 3DGS 模型加载器
│   ├── hooks/                      # 自定义 hooks
│   ├── assets/                     # 静态资源
│   ├── App.tsx                     # 主应用组件
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

1. 将你的 .ply 格式 3DGS 模型文件放入 `public/` 目录
2. 在 `App.tsx` 中修改文件路径
3. 点击 UI 中的「加载 3DGS 模型」按钮

### 操作说明

- **鼠标左键拖拽**：旋转视角
- **鼠标滚轮**：缩放

## 技术栈

- React 18
- TypeScript
- Vite
- PlayCanvas

## 开发说明

本项目为学习项目，包含以下功能模块：

1. **PlayCanvas 初始化**：创建 3D 场景、相机、光源
2. **轨道相机控制**：实现交互式视角控制
3. **3DGS 模型加载**：支持加载 .ply 格式的高斯溅射模型
4. **基础 UI**：提供加载控制和操作说明

## 下一步

- 实现真实的 3DGS 渲染 Shader
- 添加模型数据预处理
- 优化渲染性能
- 添加更多交互功能
