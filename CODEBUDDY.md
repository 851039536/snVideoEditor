# CODEBUDDY.md

## 项目概述
- **名称**: SN Video Editor — 模块化视频编辑桌面工具
- **技术栈**: Electron 31 + Vite 5 + Vue 3.4 + TypeScript 5 + Pinia + Vue Router 4 + TailwindCSS
- **框架**: electron-vite 2.x（三进程分离：main/preload/renderer）
- **视频处理**: fluent-ffmpeg + ffmpeg-static + ffprobe-static
- **加密**: Node.js crypto (AES-256-CTR)

## 常用命令
```bash
npm install   # 安装依赖
npm run dev   # 启动开发模式
npm run build # 构建（勿私自执行，太慢）
```

## 项目结构
```
src/
├── main/                     # Electron 主进程
│   ├── index.ts              # 入口：创建窗口 + 注册 IPC
│   └── modules/              # ffmpeg.ts / crypto.ts / file.ts
├── preload/                  # contextBridge 安全 API
│   ├── index.ts
│   └── index.d.ts
└── renderer/src/
    ├── views/                # 页面视图（每个功能模块一个子目录）
    │   ├── SplitMerge/       # 视频分割与合并（SplitMergeView + ClipList）
    │   ├── HomeView.vue
    │   ├── CompressView.vue
    │   └── EncryptView.vue
    ├── components/           # 跨功能通用组件
    │   ├── SideNav.vue       # 侧边导航
    │   ├── FileDropZone.vue  # 文件拖放区
    │   ├── ProgressPanel.vue # 进度面板
    │   └── VideoPreview.vue  # 视频预览缩略图
    ├── stores/               # Pinia 状态管理
    │   ├── progress.ts
    │   └── settings.ts
    ├── router/
    │   └── index.ts
    └── assets/
        └── styles/           # 全局样式
```

## 代码风格
- **if 语句必须带花括号 `{}`**，即使只有一行也不能省略
- Vue 组件使用 `<script setup lang="ts">` + Composition API
- 主进程模块用 function 导出，通过 `ipcMain.handle/handle` 注册
- 预加载通过 `contextBridge` 暴露 typed API
- TypeScript 严格模式，所有函数必须声明返回类型

## 文件组织规则
- **views 子目录规则**：完整功能模块放在 `views/<功能名>/` 子目录下，主页面命名为 `<功能名>View.vue`，子组件放同目录
  - 示例：SplitMerge 功能 → `views/SplitMerge/SplitMergeView.vue` + `views/SplitMerge/ClipList.vue`
- **components 目录**：仅放跨模块共享的通用组件
- 新增功能页面时同步更新 `router/index.ts`、HomeView 入口卡片

## 设计风格
- 深色科技风（Dark Tech），支持一键切换浅色主题
- 主题通过 `<html>` 上的 `.light` class + CSS 变量双体系驱动
- 配色全部使用 CSS 变量，Tailwind 通过 `var(--color-*)` 引用
- 深色: bg #0D1117 / #161B22 / #21262D, text #E6EDF3 / #8B949E
- 浅色: bg #FFFFFF / #F6F8FA / #EBEDF0, text #1F2328 / #656D76
- 渐变主色: accent-blue → accent-purple
- 玻璃态卡片 + 霓虹光晕 + 微动效
- 主题切换按钮位于 SideNav 底部，localStorage 持久化

## 构建注意事项
- **禁止私自执行 `npm run build` 或 `dotnet build`**，太慢太卡，修改后由用户自行验证
- ffmpeg-static / ffprobe-static 通过 `require()` 动态加载
- electron-builder 打包时 ffmpeg 二进制需随 app 分发
