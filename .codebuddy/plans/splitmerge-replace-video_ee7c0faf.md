---
name: splitmerge-replace-video
overview: 在 SplitMergeView 裁剪模式下，加载视频后支持通过「替换视频」按钮和拖拽新视频到播放器区域来替换当前视频，替换时自动清除旧裁切片段并重置状态。
todos:
  - id: add-replace-logic
    content: 新增 replaceVideo、pickReplaceVideo、拖拽处理函数及 VIDEO_EXTENSIONS 常量，导入 RefreshCw 图标
    status: completed
  - id: modify-template
    content: 在播放器容器添加拖拽事件与遮罩层，在文件信息栏添加替换视频按钮
    status: completed
    dependencies:
      - add-replace-logic
---

## 用户需求

在裁剪模式（Split）下，用户拖拽视频进入后无法替换为其他视频，只能关闭程序重开。

## 问题分析

1. 裁剪模式加载视频后，`FileDropZone` 因 `v-if="files.length === 0"` 消失，无法再拖拽新文件
2. 播放器控制栏仅有一个极小的 X 按钮可移除文件，用户未发现
3. `addFiles` 只做追加（`files.value.push`），裁剪模式只用 `files[0]`，即使能拖入也不会替换

## 核心功能

- 在裁剪模式播放器旁新增「替换视频」按钮，点击后弹出文件选择器，选择新视频后替换当前视频
- 支持直接拖拽新视频文件到播放器区域进行替换
- 替换时自动清理旧的裁切片段临时文件、重置裁剪时间轴和播放状态
- 保留现有 X 移除按钮不变

## 技术栈

- Vue 3.4 + TypeScript + `<script setup lang="ts">` + Composition API
- 仅修改 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 单文件

## 实现方案

### 1. 新增 `replaceVideo` 核心函数（script 区，约第 225 行 `removeFile` 之后）

负责替换视频的完整状态重置链：

- 调用 `releaseVideoResource()` 释放当前 video 元素 src
- 遍历 `clips.value` 删除每个片段的临时文件（复用第 603-605 行 `onUnmounted` 中的清理模式），然后 `clips.value = []`
- 重置裁剪状态：`errorMsg.value = ''`、`trimStartSec.value = 0`、`currentTime.value = 0`、`isPlaying.value = false`
- 替换文件列表：`files.value = [newPath]`（裁剪模式只保留单文件）
- 重置输出名：基于新文件名生成 `xxx_output`
- 调用 `loadVideoMeta(newPath)` 加载新元数据（该函数内部会重置 duration / trimEnd / currentTime 并 `videoPlayer.value.load()`）

### 2. 新增「替换视频」按钮点击处理 `pickReplaceVideo`

- 调用 `window.electronAPI.selectVideoFiles()` 打开文件选择器
- 取返回数组的第一个文件调用 `replaceVideo`

### 3. 新增拖拽替换支持

让 `.video-player-container`（第 652 行）成为拖放目标：

- 新增 `const isDraggingReplace = ref(false)` 状态
- 新增 `VIDEO_EXTENSIONS` 局部常量（复用 FileDropZone 默认列表 `['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp']`）
- `onReplaceDragOver(event)`：`event.preventDefault()` + `isDraggingReplace.value = true`
- `onReplaceDragLeave()`：`isDraggingReplace.value = false`（需检查 `relatedTarget` 是否仍在容器内，避免子元素切换导致闪烁）
- `onReplaceDrop(event)`：提取 `event.dataTransfer.files`，过滤视频扩展名，取第一个调用 `replaceVideo`，重置 `isDraggingReplace`

### 4. 模板修改（第 650-712 行 `<template v-else>` 内）

- 在 `.video-player-container` div 上绑定 `@drop.prevent="onReplaceDrop"` `@dragover.prevent="onReplaceDragOver"` `@dragleave="onReplaceDragLeave"`
- 在容器内添加拖拽遮罩层 `v-if="isDraggingReplace"`，显示「松开以替换视频」提示 + 渐变光晕，复用 FileDropZone 的视觉风格（`bg-gradient-to-r from-accent-blue/10 to-accent-purple/10 animate-pulse-glow`）
- 在第 703-709 行 X 按钮旁新增「替换视频」按钮，使用 `RefreshCw` 图标（从 lucide-vue-next 导入），点击调用 `pickReplaceVideo`

### 5. 图标导入

在第 3-6 行 import 中添加 `RefreshCw`

## 目录结构

```
src/renderer/src/views/SplitMerge/
└── SplitMergeView.vue  # [MODIFY] 唯一修改文件
```

### SplitMergeView.vue 修改详情

- **Script 区（第 3-6 行）**：import 添加 `RefreshCw` 图标
- **Script 区（第 96 行附近）**：新增 `const isDraggingReplace = ref(false)` 状态 + `VIDEO_EXTENSIONS` 常量
- **Script 区（第 225 行 `removeFile` 之后）**：新增 `replaceVideo(newPath)`、`pickReplaceVideo()`、`onReplaceDragOver()`、`onReplaceDragLeave()`、`onReplaceDrop()` 五个函数
- **Template 区（第 652 行 `.video-player-container`）**：添加拖拽事件绑定 + 拖拽遮罩层
- **Template 区（第 703-709 行文件信息栏）**：在 X 按钮前新增「替换视频」按钮

## 实现注意事项

- `onReplaceDragLeave` 需检查 `event.relatedTarget` 是否为 null 或不在容器内才触发，避免鼠标在子元素间移动时遮罩闪烁
- `replaceVideo` 中删除 clips 临时文件用 `window.electronAPI.deleteFile(c.outputFile).catch(() => {})`，与 `onUnmounted` 清理逻辑一致
- `loadVideoMeta` 内部已有 `loadRequestId` 竞态保护，替换时无需额外处理
- 所有样式使用 CSS 变量 / Tailwind class，不硬编码颜色
- if 语句带花括号，函数声明返回类型，遵循项目代码风格