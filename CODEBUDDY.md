# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
│   ├── index.ts              # 入口：创建窗口 + 注册 IPC handlers（使用 wrapOperation 统一模式）
│   └── modules/              # ffmpeg.ts / crypto.ts / file.ts
├── preload/                  # contextBridge 安全 API
│   ├── index.ts              # electronAPI 定义（类型 + 桥接实现）
│   └── index.d.ts            # TypeScript 全局类型声明（ElectronAPI 接口）
└── renderer/src/
    ├── views/                # 页面视图（每个功能一个子目录）
    │   ├── SplitMerge/       # 视频分割与合并（SplitMergeView + ClipList）
    │   ├── Compress/         # 视频压缩（CompressView）
    │   ├── Encrypt/          # 加密解密（EncryptView + types/）
    │   ├── Gif/              # GIF 转换（GifConvertView）
    │   ├── Player/           # 视频播放器（PlayerView + types/）
    │   ├── Download/         # 视频下载（DownloadView + DownloadQueue）
    │   └── Home/             # 首页导航（HomeView）
    ├── config/               # 全局配置
    │   └── features.ts       # 功能元数据单一数据源（HomeView/SideNav 均从此派生）
    ├── components/           # 跨功能通用组件
    │   ├── SideNav.vue       # 侧边导航（含主题切换）
    │   ├── FileDropZone.vue  # 文件拖放区
    │   ├── ProgressPanel.vue # 进度面板
    │   ├── VideoPreview.vue  # 视频预览缩略图
    │   └── TitleBar.vue      # 自定义窗口标题栏（最大/最小/关闭）
    ├── composables/          # 组合式函数
    │   └── useFileList.ts    # 文件列表管理逻辑
    ├── stores/               # Pinia 状态管理
    │   ├── progress.ts       # 操作进度状态（含计时器）
    │   └── settings.ts       # 设置（主题、压缩预设、密码记忆）
    ├── types/                # 共享类型定义
    │   └── file.ts           # ClipItem / VideoMeta（重新导出 preload 中的 VideoMeta）
    ├── utils/                # 共享工具函数（禁止在视图组件中内联定义）
    │   ├── time.ts           # secondsToHMS / hmsToSeconds / formatDuration
    │   ├── math.ts           # clamp
    │   └── format.ts         # formatSize / getFileName
    ├── router/
    │   └── index.ts          # Hash 路由（createWebHashHistory）
    └── assets/
        └── styles/           # 全局样式 + CSS 变量主题 + 共享 partials
            ├── global.scss
            └── _timeline.scss
```

## IPC 通信架构

采用两种通道：

1. **请求-响应**：渲染进程通过 `ipcRenderer.invoke` → 主进程 `ipcMain.handle`，返回 Promise。用于文件操作、元数据、操作启动等。
2. **进度推送**：主进程通过 `event.sender.send('operation:progress', data)` 推送进度 → 渲染进程 `ipcRenderer.on` 监听。进度在调用 operation 前注册回调，完成后需 `removeProgressListener()` 清理。

取消操作：`operation:cancel` 同时清除 ffmpeg 子进程（`SIGTERM`）和 crypto 流（`destroy()`），取消后各模块 resolve(false) 而非 reject。

### IPC Handler 注册模式

所有操作类 IPC handler 统一使用 `wrapOperation` 高阶函数注册，禁止手写 `acquireLock`/`try-finally`/`releaseLock`/`sendProgress` 样板代码：

```ts
wrapOperation<TOpts>(channel, lockType, progressType, (opts, onProgress) => {
  return actualHandler({ ...opts, onProgress })
})
```

- `lockType`：操作锁标识（如 `'split'`、`'compress'`、`'crypto'`），同一时刻只允许一个操作
- `progressType`：进度事件中的 `type` 字段（如 `'split'`、`'encrypt'`），用于前端区分操作类型
- 新增操作 handler 时必须在函数体内调用 wrapOperation，不得复制粘贴旧的 try-finally 模式

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
  - 每个视图应有 `types/index.ts` 存放模块私有类型（禁止接口散落在 `.vue` 中）
- **config 目录**：功能元数据单一数据源（见 `config/features.ts`），`HomeView`/`SideNav` 均从此导入，禁止在各文件中重复定义功能列表
- **components 目录**：仅放跨模块共享的通用组件
- **utils 目录**：共享工具函数，视图组件禁止内联重复定义 `formatSize` / `getFileName` / `secondsToHMS` / `hmsToSeconds` / `clamp`，必须从 utils 导入
- **types 目录**：共享类型/接口定义。`ClipItem` 和 `VideoMeta` 统一从 `@/types/file` 导入，禁止在各视图内重复声明
- 新增功能页面时同步更新 `router/index.ts`、`config/features.ts`（HomeView 和 SideNav 自动同步）

## 架构原则（6 大原则）

基于 universal-arch-skill 审查规范，新增功能必须遵守：

| # | 原则 | 核心要求 |
|---|------|----------|
| 1 | 功能模块化 | 每个视图独立目录，含主视图 + `types/index.ts`（禁止接口散落在 .vue 中） |
| 2 | 注册完整性 | 新增视图同步更新 `config/features.ts` + `router/index.ts`（共 2 处），不得遗漏 |
| 3 | 类型安全单一数据源 | 功能列表在 `config/features.ts` 统一定义，`HomeView`/`SideNav` 均从此导入 |
| 4 | 统一入口 | 跨功能操作通过 IPC（`wrapOperation`）或 `stores/` (Pinia)，禁止直接 `fetch()`/`new CustomEvent()`/`document.execCommand()` |
| 5 | 设计 Token | 禁止硬编码颜色/间距/字体，全部使用 CSS 变量或 Tailwind utility class |
| 6 | 样式分离 | `.vue` 文件 `<style>` 优先使用 `@use` 导入外部 SCSS，禁止大量内联样式（>10 行） |

### 新增功能注册清单

```
1. 创建 views/<FeatureName>/ 目录 + 主视图 + types/index.ts
2. 在 config/features.ts 添加 FEATURE_CONFIG 条目
3. 在 router/index.ts 添加路由记录
```

> `HomeView` 和 `SideNav` 自动从 `config/features.ts` 派生，无需手动同步。

### preload 类型规则

- `ProgressInfo` / `VideoMeta` / `FileInfo` / `OperationType` 均在 `preload/index.ts` 中统一定义并导出
- `preload/index.d.ts` 通过 `import type` 从 `./index` 导入上述类型，禁止重复声明

## 样式分离规则（强制）

### 禁止
- `.vue` 文件中 `<style>` 内联超过 10 行 SCSS 代码
- 硬编码 `border-radius: Npx`（应使用 `var(--radius-*)`）
- 硬编码 `font-family`（应使用 `var(--font-sans)` / `var(--font-mono)`）
- 硬编码 hex 颜色（应使用 `var(--color-*)` 或 `hsl(var(--*))`）
- 非标准过渡时长（统一使用 `var(--transition-*)`）

### 共享样式
- 提取跨视图重复样式到 `assets/styles/_<name>.scss`（下划线前缀 = SCSS partial）
- 视图通过 `<style scoped>` 内 `@use` 导入，用 CSS 变量传递差异参数
- **⚠️ `@use` 必须放在 `<style>` 块的第一行**（SCSS 规范要求），CSS 变量覆盖放在 `@use` 之后
- 示例：`_timeline.scss` 被 `SplitMergeView` 和 `GifConvertView` 共享
  ```scss
  <style scoped>
  @use "../../assets/styles/timeline";  // ← 必须第一行

  .timeline-track {
    --timeline-height: 48px;  // CSS 变量覆盖放在 @use 之后
  }
  </style>
  ```

## 设计 Token 速查表

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | `'PingFang SC', 'Microsoft YaHei', sans-serif` | 系统字体栈 |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', 'Consolas', monospace` | 等宽字体栈 |
| `--font-size-base` | `14px` | 基准字号 |
| `--transition-fast` | `0.12s` | 所有 UI 交互过渡（按钮/hover/focus） |
| `--transition-normal` | `0.2s` | 面板展开/收起 |
| `--transition-slow` | `0.3s` | 页面过渡/导航切换 |
| `--radius-sm` | `4px` | 标签/徽章/微控件 |
| `--radius-base` | `6px` | 输入框/小控件 |
| `--radius-md` | `8px` | 卡片/section |
| `--radius-lg` | `12px` | 弹窗/主面板 |
| `--z-panel` | `10` | 浮动面板 |
| `--z-overlay` | `20` | 遮罩层 |
| `--z-modal` | `50` | 模态弹窗 |

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
