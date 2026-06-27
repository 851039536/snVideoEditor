---
name: fix-codebase-logic-bugs
overview: 修复 5 个逻辑漏洞：1) onProgress 内存泄漏 2) videoMeta 竞态条件 3) 模式切换残留状态 4) elapsed 计时不实时 5) temp 裁剪文件未清理
todos:
  - id: fix-onprogress-leak
    content: 修复 onProgress 内存泄漏：preload 先 removeAllListeners 再注册 + CompressView/EncryptView 补充 onUnmounted 清理
    status: completed
  - id: fix-elapsed-real-time
    content: 修复 progress store 中 elapsed 不实时问题：改用 ref + setInterval 每秒更新
    status: completed
  - id: fix-videometa-race-and-mode-state
    content: 修复 SplitMergeView 中 videoMeta 竞态条件 + 模式切换残留 outputName/outputDir/errorMsg
    status: completed
  - id: fix-temp-file-leak
    content: 修复 temp 裁剪文件泄漏：新增 deleteFile IPC + removeClip/merge 成功后清理
    status: completed
    dependencies:
      - fix-videometa-race-and-mode-state
  - id: verify-all-lint
    content: 验证所有修改文件 lint，确保零新增错误
    status: completed
    dependencies:
      - fix-onprogress-leak
      - fix-elapsed-real-time
      - fix-videometa-race-and-mode-state
      - fix-temp-file-leak
---

## 审查发现：5 个逻辑漏洞

### BUG 1 — onProgress 内存泄漏（严重）

preload 的 `onProgress()` 每次调用都通过 `ipcRenderer.on()` 注册新监听器但不移除旧监听器。用户每执行一次操作就累积一个回调，所有历史回调在每次进度事件时都会被重复触发。CompressView 和 EncryptView 连 `onUnmounted` 清理都没有。

### BUG 2 — videoMeta 竞态条件（严重）

`loadVideoMeta()` 是异步的，await 返回后直接赋值给全局 ref（`duration`、`trimEndSec`、`videoMeta`），不验证当前文件是否还是请求时的那个。快速切换文件时，旧请求的元数据可能覆盖新文件。

### BUG 3 — elapsed 不实时（中等）

`elapsed` 是 Vue computed，只在依赖 `startTime`/`progress` 变化时重算。操作过程中这两个值很少变，elapsed 显示冻结不动。

### BUG 4 — 模式切换残留状态（中等）

`watch(mode)` 切 merge 只清 `files`，`outputName`、`outputDir`、`errorMsg` 仍保留 split 模式旧值。

### BUG 5 — temp 裁剪文件泄漏（中等）

`cutToClipList()` 创建的临时文件在 clip 移除或 merge 完成后不删除，临时目录持续堆积垃圾文件。

## 技术栈

- 前端：Vue 3 Composition API + TypeScript + Pinia
- 后端（主进程）：Node.js child_process + fs
- 代码风格：if 语句必须带花括号

## 修改方案

### BUG 1：onProgress 内存泄漏

**preload/index.ts**：在 `onProgress` 中注册新监听器前先 `removeAllListeners('operation:progress')`，确保始终只有一个活跃监听器。

**CompressView.vue + EncryptView.vue**：添加 `onUnmounted(() => window.electronAPI?.removeProgressListener())`。SplitMergeView 已有此清理，无需改动。

### BUG 2：videoMeta 竞态条件

**SplitMergeView.vue `loadVideoMeta()`**：将 `await getVideoMeta()` 结果存入局部变量，返回后检查 `files.value[0]` 是否仍等于请求时的 `filePath`，不匹配则丢弃整个结果。

### BUG 3：elapsed 不实时

**stores/progress.ts**：`elapsed` 从 computed 改为 `ref(0)`（秒数），`start()` 中启动 `setInterval` 每秒 `+1`，`finish()`/`reset()` 中 `clearInterval`。同时新增 `elapsedStr` computed 格式化为 `MM:SS` 字符串供模板使用（保持接口兼容）。

### BUG 4：模式切换残留状态

**SplitMergeView.vue `watch(mode)`**：merge 分支追加 `outputName.value = ''`、`outputDir.value = ''`、`errorMsg.value = ''`。

### BUG 5：temp 裁剪文件泄漏

**main/index.ts**：新增 `file:delete` IPC handler，用 `fs.unlink` 删除指定文件。

**preload/index.ts + index.d.ts**：新增 `deleteFile(filePath: string): Promise<boolean>` API。

**SplitMergeView.vue**：

- `removeClip()` 中调用 `window.electronAPI.deleteFile(clip.outputFile)`
- `startProcess()` 合并成功后遍历 selected clips 删除其 temp 文件

## 修改文件清单

| 文件 | 修改内容 |
| --- | --- |
| `src/preload/index.ts` | BUG1: onProgress 内先 removeAllListeners；BUG5: 新增 deleteFile |
| `src/preload/index.d.ts` | BUG5: 新增 deleteFile 类型声明 |
| `src/main/index.ts` | BUG5: 新增 file:delete IPC handler |
| `src/renderer/src/stores/progress.ts` | BUG3: elapsed 改为 ref+setInterval 实时计时 |
| `src/renderer/src/views/SplitMerge/SplitMergeView.vue` | BUG2: loadVideoMeta 竞态保护；BUG4: watch(mode) 清残留状态；BUG5: removeClip/startProcess 删除 temp |
| `src/renderer/src/views/Compress/CompressView.vue` | BUG1: onUnmounted 添加 removeProgressListener |
| `src/renderer/src/views/Encrypt/EncryptView.vue` | BUG1: onUnmounted 添加 removeProgressListener |