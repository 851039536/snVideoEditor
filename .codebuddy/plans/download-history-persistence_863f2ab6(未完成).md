---
name: download-history-persistence
overview: 为下载模块增加历史记录持久化：新建 download-history.json 记录已完成下载；入队前按文件名检查重复并弹窗确认是否重复下载；在 DownloadView UI 上显示历史 JSON 文件路径。
---

## 用户需求
为视频下载功能增加下载历史持久化与查重机制，具体包含三项核心功能：

1. **下载完成后持久化存储**：每次下载成功后，将下载记录（文件名、URL、输出路径、完成时间、文件大小）写入 JSON 文件持久保存。
2. **重复下载检查与提示**：每次发起下载时，检查目标文件名是否已存在于历史记录中；若存在，弹出确认弹窗提示用户是否继续重复下载，用户可选择继续或取消。
3. **JSON 路径 UI 展示**：将历史记录 JSON 文件的完整路径显示在下载页面的 UI 上，并提供"打开所在文件夹"快捷操作。

## 产品概述
在现有视频下载页面基础上，增加一个独立于队列恢复机制（`download-queue.json`）的下载历史记录系统。历史记录文件 `download-history.json` 存放在 `app.getPath('userData')` 目录下，记录所有成功完成的下载任务。用户发起下载前自动查重，通过原生确认弹窗交互。页面底部新增历史记录信息条，展示 JSON 文件路径。

## 核心功能
- 下载完成时自动追加历史记录到 JSON 文件
- 发起下载前按文件名查重（Windows 下不区分大小写）
- 重复时弹出原生确认弹窗，显示文件名与上次下载时间
- UI 展示历史 JSON 完整路径，附带"打开文件夹"按钮
- 支持查看历史记录列表与清空历史（预留 API）


## 技术栈
- 复用现有项目技术栈：Electron 31 + Vue 3.4 + TypeScript 5 + Pinia
- 主进程：Node.js `fs`（同步读写 JSON，文件小且写入频率低）
- IPC 通信：`ipcMain.handle` 请求-响应模式（与现有 `download:*` 系列一致）
- 确认弹窗：Electron 原生 `dialog.showMessageBox`（通过 IPC 调用，无需第三方 UI 组件）
- UI 样式：复用现有 CSS 变量体系与 Tailwind utility class（`glass-card`、`text-text-muted` 等）

## 实现方案

### 整体策略
新增 `DownloadHistoryManager` 单例模块（与 `DownloadQueueManager` 同级、同模式），独立管理 `download-history.json`。在下载完成回调中写入记录；在入队前通过 IPC 查重并用原生弹窗确认。

### 关键技术决策
1. **独立 JSON 文件而非复用 download-queue.json**：queue 文件用于断点续传恢复（含 pending/downloading 状态项），history 文件仅记录已完成下载。两者职责分离，避免互相干扰。
2. **同步写入（`writeFileSync`）**：历史记录仅在下载完成时写入（低频），文件小（上限 1000 条），同步写入简单可靠，与 `doSaveToDisk()` 模式一致。
3. **原生 `dialog.showMessageBox` 而非自定义 Modal**：项目无第三方 UI 组件库也无现成 Modal 组件，原生弹窗最可靠且零额外代码，按钮文案可自定义。
4. **查重按文件名（case-insensitive）**：用户需求明确为"文件名一致"，Windows 文件系统不区分大小写，查重逻辑与之一致。

### 性能与可靠性
- 历史记录写入为 O(n) 序列化（n ≤ 1000），单次 < 1ms，无性能瓶颈
- 历史文件损坏时 `try/catch` 降级为空列表，不影响下载功能
- `checkDuplicate` 为 O(n) 线性扫描，n ≤ 1000，可忽略
- 历史记录上限 1000 条，超出时自动淘汰最早记录（FIFO），防止文件无限增长

### 数据流
```
下载完成（download-queue.ts startDownload.then）
  → DownloadHistoryManager.addEntry({fileName, url, output, completedAt, fileSize})
  → writeFileSync(download-history.json)

发起下载（DownloadView.vue enqueueDownload）
  → electronAPI.checkDownloadDuplicate(fileName)
  → IPC → DownloadHistoryManager.checkDuplicate(fileName)
  → 若命中：electronAPI.confirmDialog(message) → IPC → dialog.showMessageBox
    → 用户选"继续" → 正常入队
    → 用户选"取消" → 中止入队
  → 若未命中 → 正常入队
```

## 实现备注
- `download-history.ts` 仿照 `download-queue.ts` 的 `getQueueFilePath()` / `doSaveToDisk()` / `loadFromDisk()` 模式实现，路径为 `path.join(app.getPath('userData'), 'download-history.json')`
- 在 `download-queue.ts` 的 `startDownload().then()` 回调中，当 `item.status` 置为 `'completed'` 后调用 `DownloadHistoryManager.getInstance().addEntry(...)`；文件大小通过 `try { fs.statSync(item.output).size } catch` 获取，失败时 `fileSize` 为 `undefined`
- IPC handler 注册在 `registerDownloadHandlers()` 内，复用 `queueManager` 同区域，遵循现有 `ipcMain.handle` 模式
- `dialog:confirm` 注册在 `registerAppHandlers()` 内（与 `app:openFolder` 同级，属于通用 app 级别工具）
- UI 信息条复用 `glass-card` 样式 + `text-text-muted` 文字色 + `FolderOpen` 图标，路径过长时 `truncate`，"打开文件夹"按钮调用现有 `electronAPI.openFolder(getDirName(historyPath))`
- 时间格式化复用 `src/renderer/src/utils/format.ts` 中已有的工具（或在组件内用 `toLocaleString`，避免引入新依赖）

## 架构设计
```mermaid
graph LR
    subgraph 主进程
        DQM[DownloadQueueManager]
        DHM[DownloadHistoryManager<br/>新增单例]
        DQF[(download-queue.json)]
        DHF[(download-history.json<br/>新增)]
        IPC[IPC Handlers<br/>download:checkDuplicate<br/>download:getHistoryPath<br/>download:getHistory<br/>download:clearHistory<br/>dialog:confirm]
    end
    subgraph 渲染进程
        DV[DownloadView.vue]
        PA[Preload API<br/>新增方法]
    end

    DQM -->
