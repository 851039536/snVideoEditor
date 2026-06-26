# SN Video Editor 项目记忆

## 项目概述
- **名称**: SN Video Editor - 模块化视频编辑桌面工具
- **技术栈**: Electron 31 + Vite 5 + Vue 3.4 + TypeScript 5 + Pinia + Vue Router 4 + TailwindCSS
- **框架**: electron-vite 2.x（三进程分离架构：main/preload/renderer）
- **视频处理**: fluent-ffmpeg + ffmpeg-static + ffprobe-static
- **加密**: Node.js crypto (AES-256-CTR 流式加密)

## 项目结构
```
snVideoEditor/
├── src/
│   ├── main/           # 主进程 - FFmpeg 调度、加密、文件操作 + IPC handlers
│   │   ├── index.ts    # 入口：创建窗口 + 注册所有 IPC
│   │   └── modules/    # ffmpeg.ts / crypto.ts / file.ts
│   ├── preload/        # 预加载 - contextBridge 安全 API
│   │   └── index.ts + index.d.ts
│   └── renderer/       # Vue 渲染进程
│       └── src/
│           ├── views/         # Home / SplitMerge / Compress / Encrypt
│           ├── components/    # SideNav / FileDropZone / ProgressPanel / VideoPreview
│           ├── stores/        # progress.ts / settings.ts
│           └── router/
```

## 三大功能模块
1. **SplitMerge（分割合并）**: 时间点分割 / 多视频合并 / 拖拽排序
2. **Compress（压缩）**: 4级预设 + 自定义CRF/分辨率/码率/编码 / 批量处理
3. **Encrypt（加密解密）**: AES-256-CTR 流式加解密 / 密码强度检测 / 文件夹批量

## 文件组织规则
- **views 子目录规则**：完整功能模块放在 `views/<功能名>/` 子目录下，主页面命名为 `<功能名>View.vue`，子组件放同目录
  - 示例：SplitMerge 功能 → `views/SplitMerge/SplitMergeView.vue` + `views/SplitMerge/ClipList.vue`
- **components 目录**：仅放跨模块共享的通用组件
- 新增功能页面时同步更新 `router/index.ts`、HomeView 入口卡片

## 代码风格
- if 语句必须带花括号 `{}`
- 主进程模块用 function 导出，通过 ipcMain.handle/handle 注册
- 预加载通过 contextBridge 暴露 typed API
- Vue 组件使用 Composition API + `<script setup lang="ts">`

## 设计风格
- 深色科技风（Dark Tech）
- 配色: 背景 #0D1117/#161B22/#21262D, 文字 #E6EDF3/#8B949E
- 渐变: accent-blue #5B8DEF → accent-purple #A78BFA
- 霓虹蓝紫光晕卡片 + 微动效

## 启动说明
```bash
npm install   # 安装依赖（包含 ffmpeg-static 二进制下载）
npm run dev   # 启动开发模式
```

## 注意事项
- 禁止私自执行构建命令（太慢），修改代码后由用户自行验证
- ffmpeg-static 和 ffprobe-static 通过 require() 动态加载
- electron-builder 打包时 ffmpeg 二进制需随 app 分发
