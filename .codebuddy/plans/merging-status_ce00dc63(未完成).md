---
name: merging-status
overview: 下载完成后显示"合并中"而非继续显示"下载中"，通过新增 merging 状态和进度 phase 字段实现细粒度状态展示
todos:
  - id: chromium-phase
    content: chromium-downloader.ts：onProgress 类型加 phase，Phase2 传 'download'，Phase3/4 传 'merge'
    status: pending
  - id: download-pass-phase
    content: download.ts：DownloadOptions.onProgress 加 phase 字段，wrapper 透传
    status: pending
    dependencies:
      - chromium-phase
  - id: queue-merging-status
    content: download-queue.ts：status 加 'merging'；onProgress 中检测 phase='merge' 切换状态；removeItem/clearTerminal/cancelItem 守卫更新
    status: pending
    dependencies:
      - download-pass-phase
  - id: store-merging-type
    content: progress.ts：QueueItem.status 加 'merging'
    status: pending
    dependencies:
      - queue-merging-status
  - id: ui-merging-display
    content: DownloadQueue.vue：STATUS_CONFIG 加 merging 项；进度条/百分比/速度/取消/移除按钮守卫更新
    status: pending
    dependencies:
      - store-merging-type
---

## 用户需求

下载流程中区分两个阶段的 UI 状态：

- TS 分片下载阶段：显示"下载中"
- ffmpeg 合并 TS 到 MP4 阶段：显示"合并中"

## 核心功能

- chromium-downloader.ts 的进度回调新增 `phase` 字段，标明当前是下载阶段还是合并阶段
- 进度回调链（chromium-downloader → download → download-queue）完整透传 phase
- download-queue.ts 新增 `merging` 状态，检测到 phase='merge' 时自动从 downloading 切换
- 前端 UI 新增 merging 状态的图标、标签、进度条、按钮守卫

## 技术方案

### 数据流

```mermaid
sequenceDiagram
    participant CD as chromium-downloader
    participant DL as download.ts
    participant DQ as download-queue
    participant UI as DownloadQueue.vue

    CD->>DL: onProgress({ percent, speed, eta, phase:'download' })
    DL->>DQ: onProgress({ ...currentFile, totalFiles, phase })
    Note over DQ: item.status = 'downloading' (不变)
    DQ->>UI: notifyProgress → UI 显示"下载中"

    Note over CD: 分片全部下载完 → 进入 Phase 3/4

    CD->>DL: onProgress({ percent:88, speed:'转码中...', phase:'merge' })
    DL->>DQ: onProgress({ ..., phase:'merge' })
    Note over DQ: if status === 'downloading' → status = 'merging'
    DQ->>UI: notifyStatus → UI 显示"合并中"

    CD->>DL: onProgress({ percent:88~99, speed, phase:'merge' })
    DL->>DQ: onProgress({ ..., phase:'merge' })
    DQ->>UI: notifyProgress → 合并进度条 88%~99%

    CD->>DL: onProgress({ percent:100, speed:'完成', phase:'merge' })
    DL->>DQ: onProgress({ ..., phase:'merge' })
    DQ->>UI: 合并完成
```

### 修改文件及具体位置

#### 1. chromium-downloader.ts — 进度回调增加 phase

- L38-42 `onProgress` 类型：`{ percent: number; speed: string; eta: string; phase?: 'download' | 'merge' }`
- L276-282 Phase 2 worker 进度：`phase: 'download'`
- L313 Phase 3 "转码中..."：`phase: 'merge'`
- L383-388 Phase 4 ffmpeg 进度：`phase: 'merge'`
- L399 Phase 4 完成：`phase: 'merge'`

#### 2. download.ts — 透传 phase

- L15-21 `DownloadOptions.onProgress` 类型增加 `phase?: string`
- L63-72 wrapper 中透传 `data.phase`

#### 3. download-queue.ts — 新增 merging 状态 + 守卫更新

- L21 `QueueItem.status`：`'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'paused'`
- L420-426 `onProgress`：`if (data.phase === 'merge' && item.status === 'downloading') { item.status = 'merging' }`
- L125 `removeItem`：`if (item.status === 'downloading' || item.status === 'merging') { return false }`
- L140 `clearTerminal` filter 保留：`i.status === 'pending' || i.status === 'downloading' || i.status === 'paused' || i.status === 'merging'`
- L215 `cancelItem`：`if (item.status === 'downloading' || item.status === 'merging') { this.killAndRelease... }`
- L456-466 `.finally()` 中：merging 状态需要保持（不做特殊处理，Promise 返回后自然由 then/catch 接管）
- L435-446 `.then()` 中：guard 已检查 `item.status === 'downloading'`，merging 不会被覆盖

#### 4. progress.ts — 前端类型同步

- L13 `QueueItem.status`：加 `'merging'`

#### 5. DownloadQueue.vue — UI 更新

- L20-27 `STATUS_CONFIG` 新增：`merging: { icon: Download, class: 'text-accent-blue animate-pulse', bg: 'bg-accent-blue/10', label: '合并中' }`
- L144 进度条条件：`item.status === 'downloading' || item.status === 'paused' || item.status === 'merging'`
- L150 shimmer 动画：`item.status === 'downloading' || item.status === 'merging'`
- L156 百分比：`item.status === 'downloading' || item.status === 'merging'`
- L158 速度：`item.status === 'downloading' || item.status === 'merging'`（合并时 ffmpeg 也会上报 speed）
- L184 取消按钮：`item.status === 'downloading' || item.status === 'paused' || item.status === 'merging'`
- L200 移除按钮：`item.status !== 'downloading' && item.status !== 'merging'`
- L167 暂停按钮：保持 `item.status === 'downloading'`（合并不可暂停）

### 防守逻辑表

| 操作 | downloading | merging | 说明 |
| --- | --- | --- | --- |
| 取消 | 允许 | 允许 | killAndRelease kill ffmpeg |
| 暂停 | 允许 | 禁止 | 合并阶段暂停无意义 |
| 移除 | 禁止 | 禁止 | 活跃任务不可移除 |
| 重试 | N/A | 禁止 | retryItem 只接受 failed/cancelled |


### 性能考虑

- phase 字段通过已有 onProgress 回调传递，无额外 IPC 开销
- status 切换仅触发一次 notifyStatus，不影响进度上报频率
- 合并阶段 speed 来自 ffmpeg stderr parseProgressLine，无需额外计算