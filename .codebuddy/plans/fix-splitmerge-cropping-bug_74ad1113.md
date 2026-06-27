---
name: fix-splitmerge-cropping-bug
overview: 修复 SplitMerge 裁剪合并后输出内容与裁剪前一致的问题：1) 切换合并模式时清空 files 数组 2) ffmpeg -ss 移至 -i 之前确保准确裁剪
todos:
  - id: fix-watch-clear-files
    content: 修复 SplitMergeView.vue 中 watch(mode)，切换到 merge 模式时清空 files 数组
    status: completed
  - id: fix-ffmpeg-ss-order
    content: 优化 ffmpeg.ts 中 splitVideo 的 -ss 参数位置，从 -i 之后移至之前
    status: completed
  - id: verify-lint
    content: 验证两个文件的 lint，确保零新增错误
    status: completed
    dependencies:
      - fix-watch-clear-files
      - fix-ffmpeg-ss-order
---

## 用户需求

裁剪视频的 2 个片段后合并，输出结果与裁剪前的原始视频完全一致，而非只包含 2 个裁剪片段。需要修复此 bug。

## 核心问题

### BUG（主要）

切换到合并模式时 `files` 数组未清空。用户在裁剪模式下加载视频文件（存入 `files`），裁剪出片段后切换到合并模式，`files` 仍保留原始视频路径。`startProcess()` 合并时 `allInputs = [...selectedClipFiles, ...files.value]` 把原始完整视频也当作输入合并进去，导致输出为原始视频 + 裁剪片段（或直接等同于原始视频）。

### 优化（次要）

`ffmpeg.ts` 中 `splitVideo()` 的 ffmpeg 参数 `-ss` 位于 `-i` 之后，在 `-c copy` 模式下只能从最近关键帧开始，裁剪精度低。将 `-ss` 移至 `-i` 之前可启用更快的 input seeking 模式，提高裁剪精度。

## 技术栈

- 前端：Vue 3 Composition API + TypeScript
- 后端（主进程）：Node.js child_process + ffmpeg
- 代码风格：if 语句必须带花括号（CODEBUDDY.md 要求）

## 修改方案

### 修改 1：SplitMergeView.vue — watch(mode) 清空 files

在 `watch(mode)` 中新增 `merge` 分支：切换到合并模式时清空 `files.value`。

```typescript
watch(mode, (newMode) => {
  if (newMode === 'split') {
    loadFirstFileOnly()
    if (files.value.length > 0) {
      loadVideoMeta(files.value[0])
    }
  } else if (newMode === 'merge') {
    files.value = []
  }
})
```

**设计理由**：`files` 在 split 模式下表示待裁剪的视频源（仅 1 个），在 merge 模式下表示外部文件（用户通过 FileDropZone 单独添加）。两个用途互斥，切换时清空 `files` 是正确行为。用户如需在合并中加入额外文件，可在合并模式的 FileDropZone 中重新添加。

### 修改 2：ffmpeg.ts — 优化 splitVideo 参数顺序

将 `-ss` 参数从 `-i` 之后移至 `-i` 之前：

```typescript
const args = [
  '-ss', opts.startTime,
  '-i', opts.input,
  '-t', opts.duration,
  '-c', 'copy',
  '-avoid_negative_ts', 'make_zero',
  '-y',
  opts.output
]
```

**设计理由**：`-ss` 在 `-i` 之前时 ffmpeg 使用 input seeking —— 直接跳转到最近关键帧后开始解码，速度快且精确。在 `-c copy` 模式下尤其推荐。

## 改动范围

- `src/renderer/src/views/SplitMerge/SplitMergeView.vue`：watch(mode) 新增 merge 分支
- `src/main/modules/ffmpeg.ts`：调整 -ss 参数位置