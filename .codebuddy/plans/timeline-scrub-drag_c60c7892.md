---
name: timeline-scrub-drag
overview: 为时间轴轨道添加 pointer 拖拽实时擦洗（scrub）功能，使播放头在拖拽过程中实时跟随鼠标移动；并支持 Shift+拖拽进行精细微调。
todos:
  - id: add-scrub-logic
    content: 新增 scrubbing 状态和 startScrub 函数，扩展 onGlobalPointerMove/Up 支持 scrub，删除 onTimelineClick
    status: completed
  - id: modify-template
    content: 将时间轴轨道 @click 替换为 @pointerdown="startScrub"
    status: completed
    dependencies:
      - add-scrub-logic
---

## 用户需求

用户反馈时间轴交互存在两个问题：

1. **拖拽不跟手**：在时间轴上点击并拖拽时，播放头（中线）不会实时跟随鼠标移动，只有松开鼠标时才跳转到释放位置。当前时间轴轨道仅绑定了 `@click` 事件，click 在 mousedown+mouseup 后才触发一次 seek，缺少 pointermove 实时跟踪。
2. **希望更细腻精细**：拖拽时希望有更精细的控制能力，类似裁剪手柄已有的 Shift 精细模式。

## 产品概述

为 SplitMergeView 裁剪模式的时间轴轨道添加 pointer 拖拽擦洗（scrub）功能，使播放头在鼠标拖拽过程中实时跟随移动，并支持 Shift 键进入精细模式实现更细腻的定位。

## 核心功能

- 点击时间轴轨道任意位置并拖拽，播放头实时跟随鼠标位置移动
- 按住 Shift 拖拽时进入精细模式，移动幅度缩减为原来的 1/5，实现细腻定位
- 拖拽开始时自动暂停视频播放，避免擦洗与播放冲突
- 单次点击仍可立即跳转到指定位置（pointerdown 即 seek）
- 与现有裁剪手柄拖拽互不干扰（手柄已有 stopPropagation 隔离）

## 技术栈

- Vue 3.4 + TypeScript + `<script setup lang="ts">` + Composition API
- Pointer Events API（setPointerCapture + 全局 pointermove/pointerup）
- 仅修改 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 单文件

## 实现方案

### 问题根因

时间轴轨道（`.timeline-track`，模板第 883 行）只绑定了 `@click="onTimelineClick"`。`onTimelineClick`（第 435-439 行）仅在 click 事件触发时执行一次 `seekVideoPlayer(getTimelineTime(e.clientX))`，没有 pointermove 实时跟踪机制。

对比：裁剪手柄（trim-handle）有完整的 `@pointerdown="startHandleDrag"` → 全局 `onGlobalPointerMove` 实时拖拽机制（第 412-493 行），支持 Shift 精细模式和长视频 delta 模式。时间轴轨道缺少这套机制。

### 修改策略

复用裁剪手柄已有的全局 pointer 监听架构（`onGlobalPointerMove` / `onGlobalPointerUp` 已在 `onMounted` 中注册到 document），新增 `scrubbing` 状态与之并行，通过 `scrubbing` / `dragging` 互斥实现轨道擦洗与手柄拖拽共存。

### 关键技术决策

1. **用 pointerdown 替换 click**：pointerdown 在按下瞬间即触发 seek（涵盖单击跳转），同时启动 scrubbing 状态供 pointermove 实时跟踪。手柄的 `startHandleDrag` 已调用 `e.stopPropagation()`，点击手柄不会冒泡到轨道，天然隔离。

2. **普通模式用绝对位置映射**：`seekVideoPlayer(getTimelineTime(e.clientX))`，播放头精确跟随鼠标 X 坐标。这是最直观的擦洗行为。

3. **Shift 精细模式用 delta-based 映射**：复用 `FINE_DRAG_SCALE = 5` 和 `lastDragClientX`，移动量缩减为 1/5，实现细腻定位。与裁剪手柄的 Shift 模式行为一致。

4. **拖拽开始时暂停视频**：`videoPlayer.value?.pause()` + `isPlaying.value = false`，避免擦洗时视频继续播放导致画面跳动。

## 实现注意事项

- `onGlobalPointerMove` 和 `onGlobalPointerUp` 已在组件挂载时注册到 document，`onUnmounted` 已清理，无需额外修改生命周期
- scrubbing 与 dragging 互斥：scrubbing 由轨道 pointerdown 启动，dragging 由手柄 pointerdown 启动（stopPropagation 隔离）
- 复用现有变量和函数：`FINE_DRAG_SCALE`、`lastDragClientX`、`getTimelineTime`、`seekVideoPlayer`、`clamp`、`duration`、`currentTime`
- `getTimelineTime` 已有边界保护（`duration.value <= 0` 返回 0，百分比 clamp 0-1）
- 删除 `onTimelineClick` 函数，其功能由 `startScrub` 的 pointerdown 完全覆盖

## 目录结构

```
src/renderer/src/views/SplitMerge/
└── SplitMergeView.vue  # [MODIFY] 唯一修改文件
```

### SplitMergeView.vue 修改详情

- **Script 区（第 34 行附近）**：新增 `const scrubbing = ref(false)` 状态
- **Script 区（第 435-439 行）**：删除 `onTimelineClick` 函数，新增 `startScrub(e: PointerEvent)` 函数
- **Script 区（第 445 行 `onGlobalPointerMove` 开头）**：添加 scrubbing 分支处理（普通模式 + Shift 精细模式）
- **Script 区（第 489 行 `onGlobalPointerUp` 开头）**：添加 scrubbing 退出处理
- **Template 区（第 886 行）**：将 `@click="onTimelineClick"` 替换为 `@pointerdown="startScrub"`