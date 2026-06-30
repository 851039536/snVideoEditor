---
name: fix-splitmerge-files-not-cleared-on-mode-switch
overview: 修复裁剪后合并输出仍为原始视频时长的问题。根因是切换模式时 `files` 数组未清空，导致原始未裁剪视频被一并合并。
todos:
  - id: fix-files-clear-on-mode-switch
    content: 在 SplitMergeView.vue 的 watch(mode) 中 merge 分支增加 `files.value = []`，修复切换模式时原始视频文件残留导致合并输出包含完整原视频的问题
    status: completed
---

## 问题描述

在 SplitMerge 页面中，从 3 分钟原视频裁剪 10 秒片段后切换到合并模式并点击合并，输出视频仍为 3 分钟（或约 3 分钟）。

## 根因分析

`SplitMergeView.vue` 中 `watch(mode)` 监听器（第 242-255 行）在从 split 切到 merge 模式时，仅重置了 `outputName`、`outputDir`、`errorMsg`，但未清空 `files` 数组。该数组仍保留着 split 模式下加载的原始视频路径，导致合并时将裁剪后的临时片段与原视频文件一同合并。

`canMerge` 计算属性也因此误导：仅 1 个裁剪片段 + 残留的 1 个原始文件即满足 `>= 2` 条件，启用合并按钮。

## 修复目标

- 切换到 merge 模式时清空 `files` 数组，确保仅使用显式裁剪的片段和用户在合并模式下手动添加的外部文件
- 使 `canMerge` 逻辑回归正确语义

## 技术方案

### 实现方式

在 `watch(mode)` 监听器的 `merge` 分支中增加 `files.value = []`，即可解决问题。这是最小改动、零副作用的方案。

### 改动范围

仅修改一个文件的一行代码：

- **文件**: `src/renderer/src/views/SplitMerge/SplitMergeView.vue`
- **位置**: 第 253 行 `errorMsg.value = ''` 之后
- **改动**: 增加 `files.value = []`

### 为什么这是最优方案

1. **语义正确**: `files` 在 split 模式表示"待裁剪的源视频"，在 merge 模式表示"外部添加的视频文件"。两者语义不同，不应跨模式污染。
2. **不影响合法场景**: 用户在 merge 模式下仍可通过 `FileDropZone` 的 `addFiles()` 添加外部文件，原有工作流不变。
3. **无需额外防御**: `startProcess()` 中 `allInputs` 的组装逻辑无需修改，因为 `files` 为空后只会收集裁剪片段。
4. **无 UI 变化**: 合并模式下的外部文件列表原本就只显示 `files.length > 0` 时才渲染，清空后自动隐藏，无异常。

### 相关代码流验证

- `canMerge`（第 129-132 行）: 修复前 `1 clip + 1 residual file = 2 >= 2 → true`; 修复后 `1 clip + 0 files = 1 < 2 → false`，需至少 2 个裁剪片段才能合并。
- `startProcess`（第 517-562 行）: `allInputs = [...selectedClipFiles, ...files.value]`，修复后 `files.value` 为空，仅包含裁剪片段。
- `FileDropZone` 在 merge 模式中（第 875 行）: 仍然支持 `@files-selected="addFiles"`，用户可手动添加外部文件。