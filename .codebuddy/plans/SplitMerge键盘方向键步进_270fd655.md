---
name: SplitMerge键盘方向键步进
overview: 为视频分割/变速页 SplitMergeView.vue 增加键盘左右方向键监听，触发与鼠标前进/后退按钮完全一致的步进逻辑（复用 stepForward/stepBackward，使用当前选中的步进秒数），并在输入框/下拉框等场景下跳过监听避免误操作。
todos:
  - id: add-keydown-handler
    content: 在 SplitMergeView.vue 中新增 onKeydown 函数，含输入元素（INPUT/SELECT/TEXTAREA/contentEditable）与播放器存在性守卫，映射 ArrowLeft/ArrowRight 调用 stepBackward/stepForward 并 preventDefault
    status: completed
  - id: wire-lifecycle
    content: 在 SplitMergeView.vue 的 onMounted 注册、onUnmounted 移除 keydown 监听，保持与现有 pointermove 监听模式一致
    status: completed
    dependencies:
      - add-keydown-handler
---

## 产品概述

为视频分割与合并页（SplitMergeView.vue）的步进前进/后退功能增加键盘左右方向键支持，使键盘操作与鼠标点击行为完全一致。

## 核心功能

- 监听键盘左右方向键（ArrowLeft / ArrowRight）按下事件，触发与时间轴区域前进/后退按钮完全相同的 `stepBackward()` / `stepForward()` 逻辑
- 键盘步进使用当前选中的步进秒数（1s/2s/5s/10s 下拉，默认 2s），与鼠标按钮一致
- 边界处理与鼠标一致：到达视频最前/最后时钳制在有效范围（复用已有 `clamp` 逻辑），状态更新（当前时间、播放指针）保持一致
- 在输入框（时间微调 input）、下拉框（步进秒数 select）、文本框等需要键盘输入的场景下不触发前进/后退，避免误操作
- 仅在视频播放器存在时响应（合并模式或无文件时不响应，与按钮可见性一致）

## 技术栈

- Vue 3 `<script setup lang="ts">` + TypeScript（沿用现有技术栈，不引入新依赖）

## 实现方式

在 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 中新增键盘监听，复用现有 `stepBackward()` / `stepForward()` 函数（内部已用 `clamp(t, 0, duration)` 处理边界，与鼠标按钮行为天然一致，无需重复实现边界逻辑）。

### 关键设计决策

1. **监听器绑定组件生命周期**：`onMounted` 注册 `document.addEventListener('keydown', onKeydown)`，`onUnmounted` 中对应移除。与项目既有模式一致（现有 pointermove/pointerup 监听、`PlayerView.vue` 的 keydown 模式），避免内存泄漏与跨页面残留触发。
2. **输入场景守卫**：`onKeydown` 首行检查 `e.target` 标签名，命中 `INPUT` / `SELECT` / `TEXTAREA` / `isContentEditable` 时直接返回。比 `PlayerView.vue` 现有守卫（仅 INPUT/TEXTAREA/contentEditable）多包含 `SELECT`，因为步进秒数下拉框聚焦时按方向键会切换选项，必须跳过。
3. **播放器存在性守卫**：`if (!videoPlayer.value) return`。merge 模式或无文件时时间轴按钮不可见，键盘同样不响应；`seekVideoPlayer` 内部对空播放器本就静默返回，双保险。
4. **阻止默认行为**：命中方向键时调用 `e.preventDefault()`，防止方向键触发页面滚动等默认行为。
5. **行为一致性**：键盘直接调用 `stepBackward()` / `stepForward()`，状态更新（`currentTime`、视频 `currentTime`）与边界钳制完全复用鼠标路径，无重复逻辑。

### 性能与可靠性

- 单次按键处理为 O(1)，无性能开销
- 监听器随组件挂载/卸载注册与移除，无泄漏风险
- 不修改 `stepBackward` / `stepForward` 现有实现，不影响鼠标操作回归面

## 修改文件

- [MODIFY] `src/renderer/src/views/SplitMerge/SplitMergeView.vue`：新增 `onKeydown` 处理函数，在 `onMounted` / `onUnmounted` 中注册与移除 keydown 监听

不改动 `SpeedPanel.vue`、`AudioSplitMergeView.vue`、`PlayerView.vue`。