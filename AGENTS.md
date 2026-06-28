# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述
- **名称**: SN Video Editor — 模块化视频编辑桌面工具
- **技术栈**: Electron 31 + Vite 5 + Vue 3.4 + TypeScript 5 + Pinia + Vue Router 4 + TailwindCSS
- **框架**: electron-vite 2.x（三进程分离：main/preload/renderer）
- **视频处理**: fluent-ffmpeg + ffmpeg-static + ffprobe-static
- **加密**: Node.js crypto (AES-256-CTR)
- **UI 组件**: lucide-vue-next (图标)，无第三方 UI 组件库

## 常用命令
```bash
npm install   # 安装依赖
npm run dev   # 启动开发模式（同时启动 main/preload/renderer 三进程）
npm run build # 构建（勿私自执行，太慢）
```

## 项目结构
```
src/
├── main/                     # Electron 主进程
│   ├── index.ts              # 入口：创建窗口 + 注册 IPC handlers
│   └── modules/              # ffmpeg.ts / crypto.ts / file.ts
├── preload/                  # contextBridge 安全 API
│   ├── index.ts              # electronAPI 定义（类型 + 桥接实现）
│   └── index.d.ts            # TypeScript 全局类型声明（ElectronAPI 接口）
└── renderer/src/
    ├── views/                # 页面视图（每个功能一个子目录）
    │   ├── SplitMerge/       # 视频分割与合并（SplitMergeView + ClipList）
    │   ├── Compress/         # 视频压缩（CompressView）
    │   ├── Encrypt/          # 加密解密（EncryptView）
    │   └── Home/             # 首页导航（HomeView）
    ├── components/           # 跨功能通用组件
    │   ├── SideNav.vue       # 侧边导航（含主题切换）
    │   ├── FileDropZone.vue  # 文件拖放区
    │   ├── ProgressPanel.vue # 进度面板
    │   ├── VideoPreview.vue  # 视频预览缩略图
    │   └── TitleBar.vue      # 自定义窗口标题栏（最大/最小/关闭）
    ├── stores/               # Pinia 状态管理
    │   ├── progress.ts       # 操作进度状态（含计时器）
    │   └── settings.ts       # 设置（主题、压缩预设、密码记忆）
    ├── router/
    │   └── index.ts          # Hash 路由（createWebHashHistory）
    └── assets/
        └── styles/           # 全局样式 + CSS 变量主题
```

## IPC 通信架构

采用两种通道：

1. **请求-响应**：渲染进程通过 `ipcRenderer.invoke` → 主进程 `ipcMain.handle`，返回 Promise。用于文件操作、元数据、操作启动等。
2. **进度推送**：主进程通过 `event.sender.send('operation:progress', data)` 推送进度 → 渲染进程 `ipcRenderer.on` 监听。进度在调用 operation 前注册回调，完成后需 `removeProgressListener()` 清理。

取消操作：`operation:cancel` 同时清除 ffmpeg 子进程（`SIGTERM`）和 crypto 流（`destroy()`），取消后各模块 resolve(false) 而非 reject。

## FFmpeg 二进制解析策略（ffmpeg.ts）

多级 fallback 链，按顺序尝试：
1. `FFMPEG_PATH` / `FFPROBE_PATH` 环境变量
2. `ffmpeg-static` / `ffprobe-static` npm 包
3. 遍历 `__dirname` 上级目录的 `node_modules/<pkg>/<exe>`
4. 系统 PATH

所有候选路径在 Windows 上通过 `spawnSync <bin> -version` 验证可执行性（因为企业 Windows 的 AV 可能阻止二进制运行）。所有 fallback 失败时抛出中文错误信息。

## 加密格式（crypto.ts）

- 算法：`aes-256-ctr`
- 密钥派生：PBKDF2（password + 16B salt, 100000 次迭代, SHA-256）→ 32B key
- 文件格式：64B 头部（16B IV + 16B salt + 32B 保留） + 密文
- 解密时从头部提取 IV 和 salt 重建密钥
- 流式处理（64KB chunks），支持大文件
- 密码最少 4 字符，加密模式需确认密码

## 临时文件目录

- 分割片段：`app.getPath('temp')/sn-video-clips/`，app 退出时 `rmSync` 清理
- 解密预览：`<tempDir>/sn_preview_<timestamp>.mp4`，切换文件或组件卸载时清理

## 窗口架构

- 无边框窗口（`frame: false`），自定义 TitleBar.vue 实现拖拽和窗口控制
- `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`
- 窗口控制通过 `ipcMain.on('window:*')` 操作 `BrowserWindow`

## 代码风格
- **if 语句必须带花括号 `{}`**，即使只有一行也不能省略
- Vue 组件使用 `<script setup lang="ts">` + Composition API
- 主进程模块用 function 导出，通过 `ipcMain.handle` 注册
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
- 无测试框架，当前项目没有配置任何测试
