---
name: splitmerge-audit-fix
overview: 审查 SplitMerge 模块发现 1 个回归缺陷（startProcess 三处未清理 onProgress 监听器导致 IPC 监听残留）+ 2 项冗余（切 merge 未清 video 状态、watch(duration) 冗余）+ 2 项轻度防御性缺失，给出修复方案。
todos:
  - id: fix-progress-listener-leak
    content: 修复 startProcess 合并成功/失败/异常三处补 removeProgressListener，消除 onProgress 监听器残留
    status: completed
  - id: fix-clip-temp-cleanup
    content: 修复 cutToClipList 裁剪取消/失败时清理临时片段文件，outputFile 声明提至 try 外
    status: completed
    dependencies:
      - fix-progress-listener-leak
  - id: cleanup-redundant-code
    content: 删除死代码 watch(duration)，merge 分支补清空 video 状态，toggleClipSelection 加越界守卫
    status: completed
    dependencies:
      - fix-clip-temp-cleanup
---

## 用户需求

针对 `src/renderer/src/views/SplitMerge` 模块（SplitMergeView.vue + ClipList.vue），审查当前功能的**代码逻辑漏洞、冗余、内存泄露风险**，并给出修复方案。

## 审查发现

### A. 逻辑漏洞 / 内存泄露

**A1【严重·回归缺陷】startProcess 三处未清理 onProgress 监听器**
`SplitMergeView.vue:535-564`，`startProcess` 注册 `onProgress` 后，成功（`store.finish()`）、失败（`store.reset()`）、异常（`store.reset()`）三处均未调用 `removeProgressListener()`。上一轮修复的 replace 静默未生效，lint 无法检测监听器缺失。
后果：合并后 `operation:progress` 的 ipcRenderer 监听器残留，闭包持有 store 引用；后续裁剪时主进程推送 split 进度误触发遗留 callback（被 isProcessing 守卫拦截但 IPC 事件持续构造分发，浪费且语义错误）。

**A2【中等】裁剪取消/失败后临时片段文件残留**
`cutToClipList:443-475`，`splitVideo` 取消（resolve(false)）或失败（reject）时 ffmpeg 可能已部分写入 `outputFile`。success=false 不 push clip，该临时文件无人清理，残留至 app 退出。运行期间 temp 目录累积残留文件，属资源泄露。

### B. 冗余

**B1【中等】watch(duration) 死代码**
`:178-182`，duration 仅由 `loadVideoMeta`（:212）设置，紧接着设 `trimEndSec=meta.duration`（:214）。watch 触发时 trimEndSec 已等于 newDur，条件 `trimEndSec>newDur` 恒 false，永不生效，属冗余防御代码。

**B2【轻度】切 merge 模式未清空 video 状态**
`watch(mode)` merge 分支 :246-252 未清空 `videoMeta/duration/trimStartSec/trimEndSec/currentTime/isPlaying`。切回 split 时为陈旧值。

### C. 防御性缺失

**C1【轻度】toggleClipSelection 无越界守卫**
`:488-490`，index 越界时 `clips.value[index]` 为 undefined，`.selected` 抛错。当前调用方总是有效但缺乏防御。

### 不修改项

- `ClipList.vue`：无逻辑漏洞/冗余/泄露，结构清晰
- `swapArrayElements` 下标修改 ref 数组：Vue3 reactive Proxy 触发响应式，无问题
- `loadVideoMeta` 竞态守卫（loadRequestId + files[0] 比对）：正确
- `onUnmounted` 清理链：完整（removeEventListener + releaseVideoResource + 临时文件 + removeProgressListener + store.reset）

## 技术栈

基于现有项目，无新增依赖：Vue 3.4 Composition API（`<script setup lang="ts">`）、Pinia store、Electron IPC（`window.electronAPI`）。仅修改 `SplitMergeView.vue` 一个文件。

## 实现方案

### 修复 A1：startProcess 三处补 removeProgressListener（核心，修复回归）

`SplitMergeView.vue:546-564`，在合并成功 `store.finish()` 后、失败 `store.reset()` 后、异常 `store.reset()` 后，三处均添加 `window.electronAPI.removeProgressListener()`。`onUnmounted` 中的调用保留作兜底。`removeProgressListener` 内部 `removeAllListeners('operation:progress')`，幂等无副作用。

### 修复 A2：cutToClipList 失败/取消清理临时片段文件

`cutToClipList:443-475`，outputFile 在 try 块内 splitVideo 调用前已生成（:447）。在 `if (success)` 后补 `else` 分支清理，及 catch 块中清理：

```ts
if (success) { ... }
else {
  window.electronAPI.deleteFile(outputFile).catch(() => {})
}
```

catch 块末尾加 `window.electronAPI.deleteFile(outputFile).catch(() => {})`。需将 outputFile 声明提到 try 外或用 let 确保 catch 可访问——当前 outputFile 在 try 内 const 声明，catch 无法访问，需重构为 try 外 `let outputFile = ''` 先声明。

### 修复 B1：删除冗余 watch(duration)

删除 `:178-182` 整个 watch 块。loadVideoMeta 已正确设置 trimEndSec。

### 修复 B2：merge 分支清空 video 状态

`watch(mode)` merge 分支 :246-252 补充：

```ts
videoMeta.value = null
duration.value = 0
trimStartSec.value = 0
trimEndSec.value = 30
currentTime.value = 0
isPlaying.value = false
```

trimEndSec 重置为 30（与初始声明 :42 一致），切回 split 重新加载文件时由 loadVideoMeta 覆盖。

### 修复 C1：toggleClipSelection 越界守卫

```ts
function toggleClipSelection(index: number): void {
  const clip = clips.value[index]
  if (clip) {
    clip.selected = !clip.selected
  }
}
```

## 实现注意事项

- A2 修复需将 outputFile 声明从 try 内 const 提到 try 外 let，确保 catch 可访问，避免 ReferenceError
- B2 清空状态后，切回 split 若未重新加载文件，videoSrc 由 files 派生返回 ''，video v-if 不渲染，无空指针风险
- 所有修改均为渲染进程内部逻辑，不改变 IPC 接口与功能流程

## 目录结构

```
src/renderer/src/views/SplitMerge/
├── SplitMergeView.vue   # [MODIFY] 修复 A1/A2/B1/B2/C1 共 5 处
└── ClipList.vue          # [不变] 审查后无问题
```