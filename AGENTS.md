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
│   ├── index.ts              # 入口：创建窗口 + 注册 IPC handlers（使用 wrapOperation 统一模式）
│   └── modules/              # ffmpeg.ts / crypto.ts / file.ts
├── preload/                  # contextBridge 安全 API
│   ├── index.ts              # electronAPI 定义（类型 + 桥接实现）
│   └── index.d.ts            # TypeScript 全局类型声明（ElectronAPI 接口）
└── renderer/src/
    ├── views/                # 页面视图（每个功能一个子目录）
    │   ├── SplitMerge/       # 视频分割与合并（SplitMergeView + ClipList）
    │   ├── Compress/         # 视频压缩（CompressView）
    │   ├── Encrypt/          # 加密解密（EncryptView）
    │   ├── Gif/              # GIF 转换（GifConvertView）
    │   └── Home/             # 首页导航（HomeView）
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
        └── styles/           # 全局样式 + CSS 变量主题
```

## IPC 通信架构

采用两种通道：

1. **请求-响应**：渲染进程通过 `ipcRenderer.invoke` → 主进程 `ipcMain.handle`，返回 Promise。用于文件操作、元数据、操作启动等。
2. **进度推送**：主进程通过 `event.sender.send('operation:progress', data)` 推送进度 → 渲染进程 `ipcRenderer.on` 监听。

### 进度监听器生命周期（强制）

- **监听器绑定组件生命周期，而非操作函数**：`onProgress` 必须在视图的 `onMounted` 注册、`onUnmounted` 移除（调用 `removeProgressListener()`），覆盖组件整个挂载期。禁止在 `startXxx` 操作函数内部临时注册监听器——否则切换页面再返回后不会重新订阅，进度面板会冻结或消失。
- **全局进度终态与组件本地 UI 解耦**：操作完成回调中，`progressStore.finish()/reset()`（全局状态）必须无条件执行；只有组件本地 UI 更新（结果列表、文件状态等）才用 `isUnmounted` 守卫跳过。这样用户中途切走/切回，进度面板仍能正确显示实时进度与完成态。
- **按文件索引更新状态时用组件级快照**：常驻监听器通过组件级快照（如 `runSnapshot`）读取当前批次文件，避免运行中列表变动导致索引错位。

取消操作：`operation:cancel` 同时清除 ffmpeg 子进程（`SIGTERM`）和 crypto 流（`destroy()`），取消后各模块 resolve(false) 而非 reject。

### IPC Handler 注册模式

所有操作类 IPC handler 统一使用 `wrapOperation` 高阶函数注册，禁止手写 `acquireLock`/`try-finally`/`releaseLock`/`sendProgress` 样板代码：

```ts
wrapOperation<TOpts>(channel, lockType, progressType, (opts, onProgress) => {
  return actualHandler({ ...opts, onProgress });
});
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
- **components 目录**：仅放跨模块共享的通用组件
- **utils 目录**：共享工具函数，视图组件禁止内联重复定义 `formatSize` / `getFileName` / `secondsToHMS` / `hmsToSeconds` / `clamp`，必须从 utils 导入
- **types 目录**：共享类型/接口定义。`ClipItem` 和 `VideoMeta` 统一从 `@/types/file` 导入，禁止在各视图内重复声明
- 新增功能页面时同步更新 `router/index.ts`、HomeView 入口卡片

## 代码质量规则（强制）

### 文件头注释

所有 `.ts` / `.vue` 文件顶部必须包含注释，简要说明文件职责（10~30 字）。禁止遗漏或写 "TODO" 占位。`.scss`、`.md`、配置文件（`electron.vite.config.ts`、`tailwind.config.js` 等）不要求。

| 文件类型 | 格式 | 示例 |
| -------- | ---- | ---- |
| `.ts` | `// 文件功能说明`（或 JSDoc 块注释） | `// ffmpeg 二进制解析与进度处理` |
| `.vue` | `<!-- 文件功能说明 -->` | `<!-- 视频压缩页面 -->` |

- `.vue` 注释放在**文件最顶部、第一个块之前**（本项目 .vue 均以 `<script setup>` 开头，注释写在 `<script setup>` 之前）
- 描述文件的职责而非实现细节，不要求写文件路径前缀
- **注释语言统一使用中文**（包括文件头、行内注释、JSDoc `/** */` 描述）；代码标识符保持英文
- 执行策略：新增文件必须；修改已有文件时建议顺带补上缺失的注释；禁止专门发起批量补注释的变更
- 正面示例：`src/main/modules/ffmpeg.ts`、`src/renderer/src/composables/useScreenshot.ts`

### 单文件行数上限

| 级别 | 行数范围 | 评价 |
| ---- | -------- | ---- |
| 理想 | ≤ 200 行 | 职责单一，易读易维护 |
| 可接受 | 200 ~ 300 行 | 轻微超限，可留可不拆 |
| 需要关注 | 300 ~ 500 行 | 建议重构，考虑拆分 |
| 严重超标 | 500 ~ 1000 行 | 强烈建议拆分 |
| 必须重构 | ≥ 1000 行 | 不可维护，必须拆分 |

- **300 行是警戒线，500 行是硬阈值，1000 行以上属于不可维护代码**；但更重要的是职责是否单一，而非机械按行数拆分
- Vue 组件超过 500 行 → 拆分逻辑（composable）与子组件
- 单个函数最佳 ≤30 行（Rule of 30），超过 50 行应提取子函数
- 辅助判断指标：圈复杂度 >10~15、嵌套深度超过 4 层、一个文件做 >1 件事
- 快速判断 3 问：滚轮超过 3~4 屏才能看完？不能用一个短句说清职责？改了需求 A 会不小心影响 B？——任一为"是"就该拆
- **存量文件执行策略**：新增文件强制遵守；存量超标文件为已知技术债，仅在因功能变更触碰该文件时渐进拆分，**禁止主动发起纯重构**
- 当前已知超标清单（技术债备案）：`PlayerView.vue`（约 1445 行）、`SplitMergeView.vue`（约 1082 行）、`DownloadView.vue`（约 795 行）、`main/index.ts`（约 577 行）、`GifConvertView.vue`（约 522 行）。`CompressView.vue` 已于 2026-07 拆分（→ useCompressPreset / useCompressBatch / CompressParams.vue），降至约 330 行

### 模块提取判定标准

核心原则：**重复远比错误抽象便宜。同一问题出现 3 次之前，不要抽象**（Rule of Three，Sandi Metz《The Wrong Abstraction》）。提取独立文件不是"越拆越好"，错误的抽象比重复更难维护。

**Vue 组件提取判定：**

- 必须提取：被 2 个以上父组件复用（提升到 `components/`）；文件超 500 行硬阈值；含独立复杂内部状态（≥3 个 ref/reactive + 对应操作函数）；通过 Vue 官方"紧密耦合组件"测试——子组件在父组件语境下有明确独立的子领域含义（如 `ClipList` 之于 `SplitMergeView`，放同一 views 子目录）
- 不应提取：仅 1 处使用的薄壳包装（`<slot>` + ≤2 个 ref + 简单外壳）；≤80 行且无独立业务逻辑；仅是对原生 HTML 元素的简单封装；提取后父组件反而更难读（需跨文件跳跃才能理解完整 UI 流）
- 补充：单例组件用 `The` 前缀、纯展示基础组件用 `Base` 前缀，因其独立/通用性质，即使只用一次也可独立成文件

**utils / types 提取判定：**

| 条件 | 判定 |
| ---- | ---- |
| 被 2 个以上文件使用 | 必须提取（与「utils 目录禁止内联」规则递进） |
| 仅 1 文件使用，但逻辑复杂（>30 行） | 可提取，改善父文件可读性 |
| 仅 1 文件使用，且逻辑简单（≤10 行） | 不应提取，反而增加引用跳转成本 |

**composable 提取判定：**

- ≥3 个相关 ref/函数构成独立概念 → 提取到 `composables/`（正面案例：`useScreenshot` 从 `PlayerView` 提取、`useTrimTimeline` 被多视图复用）
- 被 2 个以上组件共享 → 必须提取
- 1~2 个函数仅 1 处使用 → 保留在组件内

**components 子文件夹组织：**

- 目录文件 ≥15 个且同类型组件 ≥3 个才允许建子文件夹（Rule of Three 的文件夹版）
- 按职责类型命名（如 `charts/`），禁止按页面/Tab 分组；每层最多 3 个子文件夹
- 当前 `components/` 仅 6 个文件，保持平铺（此条为预防性约束）

**提取前 4 问自检：**

1. 这个文件被 2 个以上的地方用到吗？——没有 → 大概率不该提取
2. 能用一句话说清它的职责吗？——不能 → 职责不清晰，暂不提取
3. 提取后父文件是否反而更难读？——是 → 不要提取
4. 这是同一问题的第 3 次出现吗？——不是 → 等到第 3 次再抽象

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
