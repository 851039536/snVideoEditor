---
name: fix-compress-cancel-bug
overview: 修复压缩过程点击 X 无法取消的 bug，涉及 3 个文件、3 处改动。
todos:
  - id: fix-progresspanel-cancel
    content: 修复 ProgressPanel.vue：X 按钮从 store.reset() 改为 store.cancel()
    status: completed
  - id: fix-batchcompress-cancelled
    content: 修复 ffmpeg.ts batchCompress：取消时不做 success++，直接 break
    status: completed
  - id: fix-compressview-guard
    content: 修复 CompressView.vue startCompress：batchCompress 返回后增加 isProcessing 守卫
    status: completed
    dependencies:
      - fix-batchcompress-cancelled
---

## 问题描述

压缩过程中点击 ProgressPanel 面板的 X 取消按钮后，ffmpeg 进程仍在后台继续运行，UI 虽已清空但实际压缩并未终止。

## 根因分析

共 3 处缺陷导致取消失败：

1. **ProgressPanel.vue**：X 按钮调用的是 `store.reset()` 而非 `store.cancel()`。`reset()` 只重置 UI 状态（清空进度条、关闭面板），从未向主进程发送取消指令，ffmpeg 进程未被 kill。
2. **ffmpeg.ts batchCompress()**：当 `compressVideo` 被取消时，Promise 以 `resolve(false)` 完成（不抛异常），`batchCompress` 的 `try` 块将其当作成功执行了 `success++`，状态计数错误。
3. **CompressView.vue startCompress()**：`store.cancel()` 先调 `cancelOperation()` 再调 `reset()` 清空进度。但 `startCompress` 仍在 `await batchCompress`，等主进程返回后又调用 `progressStore.finish()` 覆盖已清空的状态。

## 修复目标

- ProgressPanel 的 X 按钮正确调用 `store.cancel()` 发送取消 IPC
- batchCompress 在子任务被取消时不将其误计为成功
- CompressView 在操作已被取消后不再重复更新进度状态

## 修复方案

### 修复 1：ProgressPanel.vue（第 48 行）

将 X 按钮的点击事件从 `@click="store.reset()"` 改为 `@click="store.cancel()"`。

`store.cancel()` 已存在于 `progress.ts` 第 124-127 行，内部依次调用 `window.electronAPI.cancelOperation()`（IPC 通知主进程 kill ffmpeg）+ `reset()`（清空 UI）。无需新增代码。

### 修复 2：ffmpeg.ts batchCompress()（第 638-659 行）

`compressVideo()` 被取消时 `resolve(false)`（不 reject），当前 `try { success++ }` 会误计入。改为：

```ts
const result = await compressVideo({...})
if (!result) {
  if (isCancelled) { break }
  failed.push(file.input)
  continue
}
success++
```

逻辑：`compressVideo` 只会在取消时返回 `false`，正常完成返回 `true`，异常时 reject。因此 `!result` 即表示取消，直接 break 退出循环即可。

### 修复 3：CompressView.vue startCompress()（第 164-170 行）

在 `batchCompress` 返回后、调用 `finish()`/`reset()` 前增加 `isProcessing` 守卫：

```ts
const result = await window.electronAPI.batchCompress({ files: batchFiles })
if (!progressStore.isProcessing) {
  return  // 操作已被取消，进度状态已由 store.cancel() 重置
}
if (result.failed.length === 0) {
  progressStore.finish()
} else {
  errorMsg.value = `${result.failed.length} 个文件压缩失败`
  progressStore.reset()
}
```

因为 `store.cancel()` 中 `reset()` 已将 `isProcessing` 设为 `false`，此守卫可防止后续 `finish()` 覆盖已重置的状态。

## 修改文件清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/components/ProgressPanel.vue` | 第 48 行：`store.reset()` → `store.cancel()` |
| `src/main/modules/ffmpeg.ts` | 第 641-654 行：`batchCompress` 循环体内对 `compressVideo` 返回值判 `false` 后 break |
| `src/renderer/src/views/Compress/CompressView.vue` | 第 164-170 行：`batchCompress` 返回后增加 `isProcessing` 守卫 |


## 取消流程（修复后）

```
用户点击 X
  → store.cancel()
    → cancelOperation() IPC ──→ 主进程 cancelFfmpegOperation()
    │                             → isCancelled = true
    │                             → taskkill /SIGTERM kill ffmpeg 子进程
    │
    → reset() 清空 UI（isProcessing=false, progress=null）

compressVideo close 事件触发
  → 检测 isCancelled → resolve(false)

batchCompress 循环
  → 检测 !result → break（不 success++）

startCompress 收到 batchCompress 返回
  → 检测 !progressStore.isProcessing → return（跳过 finish/reset）
```