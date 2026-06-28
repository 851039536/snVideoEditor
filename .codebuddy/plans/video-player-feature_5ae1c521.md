---
name: video-player-feature
overview: 新增视频播放器功能页面，支持播放普通格式视频和加密视频（.enc），用户可选择文件添加到列表后点击播放。加密视频需输入密码解密到临时目录后播放。
todos:
  - id: extend-file-dialogs
    content: 扩展 main/modules/file.ts：新增 selectPlayerFiles（合并视频+.enc 过滤器）和 scanPlayerFiles（递归扫描视频+.enc）函数
    status: completed
  - id: create-player-module
    content: 新建 main/modules/player.ts：实现 decryptForPlayback 函数（调用 crypto.ts 原始 decryptFile，解密到临时目录，不使用操作锁）
    status: completed
  - id: register-ipc-handlers
    content: 在 main/index.ts 注册三个新 IPC handlers：file:selectPlayerFiles、file:scanPlayerFiles、video:decryptForPlayback
    status: completed
    dependencies:
      - extend-file-dialogs
      - create-player-module
  - id: update-preload-api
    content: 更新 preload/index.ts 和 preload/index.d.ts：新增 selectPlayerFiles、scanPlayerFiles、decryptForPlayback 的 API 方法及类型声明
    status: completed
    dependencies:
      - register-ipc-handlers
  - id: extend-file-drop-zone
    content: 扩展 components/FileDropZone.vue：新增可选 customSelectFunc prop，点击时若传入则调用自定义选择函数
    status: completed
  - id: create-player-view
    content: 使用 [skill:Frontend Components] 新建 views/Player/PlayerView.vue：实现文件列表（添加/删除/扫描目录）、HTML5 视频播放器、加密视频密码弹窗、临时文件清理
    status: completed
    dependencies:
      - update-preload-api
      - extend-file-drop-zone
  - id: update-router-and-nav
    content: 更新 router/index.ts（新增 /player 路由）、SideNav.vue（新增"视频播放"导航项）、HomeView.vue（新增播放器功能卡片）
    status: completed
    dependencies:
      - create-player-view
---

## 用户需求

新增视频播放器功能模块，支持播放普通格式视频和加密后的视频（.enc 文件）。

## 产品概述

在现有 SN Video Editor 中增加一个独立的视频播放器页面，用户可以通过选择文件或扫描目录的方式添加视频到播放列表，点击列表中的视频即可播放。对于加密视频（.enc），需要输入密码后解密到临时目录再播放。播放器只负责视频播放，不参与视频的存储位置管理。

## 核心功能

- **文件导入**：支持选择单个或多个视频/加密文件，支持扫描整个文件夹，支持拖拽添加
- **播放列表**：以列表形式展示所有已添加的视频，区分普通视频和加密视频（加密视频显示锁图标）
- **视频播放**：内嵌 HTML5 视频播放器，支持播放/暂停、进度条拖动、时间显示
- **加密视频解密播放**：对 .enc 文件弹出密码输入框，解密到临时目录后播放，离开页面自动清理临时文件
- **视频信息展示**：显示当前播放视频的文件名、分辨率、时长、文件大小

## 技术栈

- 前端框架：Vue 3.4 + TypeScript + Composition API (`<script setup lang="ts">`)
- 样式方案：TailwindCSS + 项目现有 CSS 变量主题（深色/浅色）
- 状态管理：组件内 `ref`/`reactive`（此功能无需全局 Store）
- IPC 通信：Electron contextBridge + ipcMain.handle / ipcRenderer.invoke
- 加密解密：复用 `crypto.ts` 中的 `decryptFile` 原始函数
- 图标：lucide-vue-next

## 实现方案

### 整体策略

在现有三进程架构下新增播放器模块，遵循项目既有的代码组织模式：主进程负责文件对话框和解密操作，预加载层暴露类型安全的 API，渲染进程负责 UI 和播放逻辑。关键决策：**解密播放不使用操作锁**，因为播放是临时预览行为，不应阻塞加解密/压缩等正式操作。

### 加密视频播放流程

```
用户点击 .enc 文件 → 弹出密码输入框 → 调用 decryptForPlayback(input, password)
→ 主进程解密到 <tempDir>/sn_player_<timestamp>.mp4 → 返回临时路径
→ 渲染进程通过 file:/// 协议加载视频 → 播放
→ 切换文件/离开页面时 deleteFile 清理临时文件
```

### 核心技术决策

1. **播放解密不用锁**：`decryptForPlayback` handler 直接调用 `crypto.ts` 的 `decryptFile` 原始函数，不经过 `wrapOperation`，避免与其他操作互斥。

2. **文件对话框扩展**：新增 `selectPlayerFiles` 对话框，过滤器合并普通视频扩展名 + `.enc`，同时支持多选。新增 `scanPlayerFiles` 扫描函数，递归搜索目录中所有视频和 .enc 文件。

3. **FileDropZone 扩展**：添加可选 `customSelectFunc` prop，允许 PlayerView 传入自定义选择函数，而不修改组件默认行为。

4. **临时文件管理**：每个加密视频解密后生成独立临时文件，记录在 `tempPaths` Map 中（filePath → tempPath），组件卸载时遍历清理。

5. **复用 EncryptView 的播放器模式**：视频播放器、时间显示、meta 加载等逻辑参考 EncryptView 现有实现，保持一致性。

### 性能考量

- 解密是流式处理（64KB chunks），对大文件友好
- 临时文件仅在切换文件时才重新解密，避免重复解密
- 普通视频直接播放，无额外开销
- 视频元数据按需加载（获取 VideoMeta 通过 ffprobe）

### 错误处理

- 密码错误时提示用户重新输入，不创建临时文件
- 文件不存在时在列表中标记并跳过播放
- 解密过程中切换文件需取消并清理中间产物
- 所有清理操作使用 try-catch 静默处理

## 使用的 Agent 扩展

### Skill

- **Frontend Components**
- 用途：设计 PlayerView.vue 组件的 props、状态管理和 UI 布局，确保组件遵循单一职责原则和可复用性
- 预期结果：生成类型安全、状态清晰的 Vue 组件代码，与现有项目模式一致