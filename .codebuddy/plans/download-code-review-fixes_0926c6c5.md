---
name: download-code-review-fixes
overview: 审查 Download 功能的代码逻辑漏洞、冗余、内存泄露风险，按严重程度列出问题并提供修复建议
todos:
  - id: extract-kill-release
    content: 提取 download-queue.ts 中 pauseItem/cancelItem 的公共逻辑为私有方法 killAndRelease，消除约20行重复代码
    status: completed
  - id: sync-currentproc
    content: 在 killAndRelease、cancelAll、pauseItem 中同步清理 ffmpeg-shared 的 currentProc，修复双重追踪导致的僵尸引用
    status: completed
    dependencies:
      - extract-kill-release
  - id: fix-httpgettext-race
    content: 修复 download.ts 中 httpGetText 的 timeout/response 竞态条件，增加 settled 标志位
    status: completed
  - id: queue-cap-limit
    content: 在 DownloadQueueManager.enqueue 中添加队列容量上限(100)，超限拒绝入队
    status: completed
  - id: unify-cancel-path
    content: 统一 standalone download 和 queue download 两种取消路径的进程引用管理
    status: completed
    dependencies:
      - sync-currentproc
  - id: fix-label-boundary
    content: 修复 getStandardLabel 中 height===0 错误标记为 144p 的边界问题
    status: completed
  - id: idempotent-enqueue
    content: 为 enqueueDownload 添加 in-flight 幂等保护，防止重复入队
    status: completed
  - id: optimize-stderr-shift
    content: 优化 download.ts 中 stderrLines 裁切逻辑，用 splice 替代多次 shift
    status: completed
---

## 审查目标

对 `src/renderer/src/views/Download/` 下载功能的完整代码链路进行审查，覆盖渲染进程（DownloadView.vue、DownloadQueue.vue）、主进程（download.ts、download-queue.ts、ffmpeg-shared.ts）、preload 层（index.ts、index.d.ts）和 store（progress.ts），识别逻辑漏洞、代码冗余和内存/资源泄露风险。

## 审查范围

- **渲染进程**: DownloadView.vue、DownloadQueue.vue、useHeaders.ts composable
- **主进程**: download.ts (httpGetText, downloadM3u8, m3u8 变体解析)、download-queue.ts (队列管理器)、ffmpeg-shared.ts (进程管理/进度解析)
- **IPC 层**: main/index.ts (handler 注册)、preload/index.ts (API 桥接)、preload/index.d.ts (类型声明)
- **状态管理**: stores/progress.ts

## 发现的问题分类

### 严重 (3项)

1. `pauseItem` 与 `cancelItem` 存在约 20 行重复的状态清理代码，逻辑几乎一致，容易因单边修改导致行为不一致
2. `currentProc`(ffmpeg-shared 模块级单例) 与 `activeProcs`(download-queue Map) 双重追踪同一进程，`cancelItem`/`pauseItem` 清除 `activeProcs` 后 `currentProc` 仍持有过期引用，存在僵尸引用风险
3. `httpGetText` 中 `req.setTimeout` 与 `res.on('data')` 存在竞态：超时后 `req.destroy()` 已执行，但已到达的数据仍会触发 `res.on('end')` 尝试 resolve 已 settled 的 Promise，chunks 数组继续积累无用数据

### 中等 (3项)

4. 下载队列无容量上限，`items` 数组可无限增长，结合 UI 中 `v-for` 全量渲染所有条目，大量队列项将导致 DOM 和内存双重压力
5. `download.ts` 的 `setFfmpegProc(proc)` 由所有调用方无条件执行，队列模式下载时 `currentProc` 被覆盖指向当前活跃进程，但 `operation:cancel` 走的是 `cancelAll()` 路径（用 `activeProcs`），导致两种取消路径使用的进程引用不一致
6. `getStandardLabel(height)` 中 `height <= 144` 分支包含了 `height === 0`（分辨率解析失败的情况），将未知清晰度错误标记为 "144p"

### 轻微 (3项)

7. `enqueueDownload` 仅依赖按钮 `disabled` 状态防重复，无函数内幂等保护
8. `stderrLines` 使用 `Array.shift()` 逐元素裁切，高频进度下 O(n) 开销可忽略但代码不够优雅
9. `buildHeaders()` 过滤空 key/value 时静默丢弃，用户输入不完整的 header 时无反馈提示

## 技术栈

- Electron 31 + Vue 3.4 + TypeScript 5 + Pinia + TailwindCSS
- Node.js child_process (spawn)
- Node.js http/https 模块

## 修复策略

### 1. 消除 pauseItem/cancelItem 重复代码

**策略**: 提取公共的 "终止下载进程并释放槽位" 逻辑为私有方法 `private killAndRelease(item: QueueItem, targetStatus: 'cancelled' | 'paused'): void`

```typescript
// download-queue.ts 新增私有方法
private killAndRelease(item: QueueItem, targetStatus: 'cancelled' | 'paused'): void {
  item.status = targetStatus
  const proc = this.activeProcs.get(item.id)
  if (proc) {
    killFfmpegProc(proc)
    setFfmpegProc(null)  // 同步清理 ffmpeg-shared 的 currentProc
  }
  this.activeIds.delete(item.id)
  this.activeProcs.delete(item.id)
  this.notifyStatus()
  this.scheduleTasks()
  if (this.activeIds.size === 0 && !this.items.some((i) => i.status === 'pending')) {
    this.isProcessing = false
  }
}
```

然后 `pauseItem` 和 `cancelItem` 的 downloading 分支都调用此方法，区别仅在于 `targetStatus` 参数。

### 2. 修复 currentProc/activeProcs 双重追踪

**策略**: 在 `killAndRelease` 中增加 `setFfmpegProc(null)` 调用，确保 `currentProc` 随 `activeProcs` 同步清除。同时在 `cancelAll` 中也调用 `setFfmpegProc(null)`。

### 3. 修复 httpGetText 竞态

**策略**: 在 `req.setTimeout` 回调中使用一个 `settled` 标志位，防止 timeout 和 response 事件重复 resolve；同时监听 `close` 事件来清理未完成的 response。

```typescript
let settled = false
// ...
req.setTimeout(timeoutMs, () => {
  if (settled) { return }
  settled = true
  req.destroy()
  reject(new Error('ETIMEDOUT'))
})
// 在 res.on('end') 中也检查
res.on('end', () => {
  if (settled) { return }
  settled = true
  resolve(Buffer.concat(chunks).toString('utf-8'))
})
```

### 4. 队列容量上限

**策略**: 在 `DownloadQueueManager.enqueue()` 中添加最大容量检查（如 100 个），超限时拒绝入队或自动移除最早完成的项。同时在 UI 中显示队列容量提示。

### 5. standalone vs queue 下载的进程引用统一

**策略**: 当前 `video:download` standalone 渠道（main/index.ts:347-354）使用 `wrapOperation` + `downloadM3u8`，其取消路径是 `cancelFfmpegOperation()`（读 `currentProc`）。队列渠道的取消路径是 `cancelAll()`（读 `activeProcs`）。由于两种渠道使用同一个 `downloadM3u8` 函数且都调用 `setFfmpegProc`，修复方案是：在 `operation:cancel` handler 中，当 `activeType === 'download'` 时，同时调用 `cancelFfmpegOperation()` 清理 `currentProc`（避免残留引用）。

### 6. getStandardLabel 边界处理

**策略**: 增加 `height === 0` 的显式判断，返回 `'未知'` 而非 `'144p'`。

### 7. enqueueDownload 幂等保护

**策略**: 在函数开头增加 in-flight 标志检查，防止快速双击或键盘重复触发的重复入队。

### 8. stderrLines 裁切优化

**策略**: 将 `while (shift())` 替换为 `if (length > MAX) { stderrLines.splice(0, length - MAX) }`，一次 splice 替代多次 shift。

### 9. buildHeaders 静默丢弃提示

**策略**: 可选修复，在 UI 中增加红色边框高亮 key 为空但 value 非空的 header 行，提示用户填写完整。