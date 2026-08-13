---
name: SplitMerge 手柄快捷键开关
overview: 在 SplitMerge 裁剪时间轴工具栏新增一个可选的快捷键开关，开启后 A/D 分别把前后手柄对齐到当前播放位置、空格/回车触发裁剪，全部复用现有函数并叠加裁剪守卫。
todos:
  - id: add-shortcut-logic
    content: 在 SplitMergeView.vue 中新增 keyboardShortcutsEnabled ref，并在 onKeydown 内追加 A/D/空格/回车快捷键分支（含裁剪守卫与 preventDefault）
    status: completed
  - id: add-shortcut-toggle-ui
    content: 在 SplitMergeView.vue 裁剪时间轴标题行添加"快捷键模式"开关 checkbox，复用"拖动时暂停"同风格样式并附快捷键提示
    status: completed
    dependencies:
      - add-shortcut-logic
---

## 产品概述

为视频分割/变速页（SplitMergeView）增加一个可选快捷键开关。默认关闭，开启后可通过键盘快速完成"定位手柄 + 裁剪"的连续操作，减少鼠标往返。

## 核心功能

- 新增开关按钮（默认关闭），开启后生效，关闭时不影响现有左右方向键步进行为
- 按 A 键：将前手柄（裁剪起点）定位到当前播放位置，等价于点击"前手柄定位"按钮
- 按 D 键：将后手柄（裁剪终点）定位到当前播放位置，等价于点击"后手柄定位"按钮
- 按空格或回车键：触发裁剪当前片段，等价于点击"裁切到列表"按钮
- 输入框/下拉框等需要键盘输入的元素聚焦时不触发快捷键，避免误操作
- 无视频文件、裁剪区间无效或裁剪进行中时不触发裁剪

## 技术栈

- Vue 3 `<script setup lang="ts">` + TypeScript（现有项目技术栈，不引入新依赖）
- 修改文件：`src/renderer/src/views/SplitMerge/SplitMergeView.vue`（存量超标文件，仅做最小增量修改，不重构）

## 实现方案

### 核心策略

复用现有基础设施，不做重复实现：

- **复用已有键盘监听**：`onKeydown` 已在 `onMounted` 注册、`onUnmounted` 移除，且已含输入类元素守卫（INPUT/SELECT/TEXTAREA/isContentEditable）与 `videoPlayer` 存在性守卫，只需在函数内追加分支
- **复用已有操作函数**：A 键调 `snapStartHere()`、D 键调 `snapEndHere()`、空格/回车调 `cutToClipList()`，与鼠标按钮行为完全同源
- **开关状态**：新增 `keyboardShortcutsEnabled = ref(false)`，分支仅在开关开启时生效

### 关键实现细节

1. **script 逻辑**（onKeydown 函数内新增分支）：

- 开关关闭时直接跳过快捷键分支（保持现有方向键行为不变）
- A/D 键：用 `e.key.toLowerCase()` 匹配，兼容 CapsLock 场景；`e.preventDefault()` 后调用 `snapStartHere()` / `snapEndHere()`
- 空格键：`e.key === ' '`，`e.preventDefault()` 防止页面滚动；回车键：`e.key === 'Enter'`
- 裁剪守卫与按钮 disabled 条件一致：`trimDuration.value > 0 && !cuttingInProgress.value`（`cutToClipList` 内部另有 `files.value.length === 0` 与 `trimDuration.value <= 0` 守卫，双层保护）
- `cuttingInProgress`、`trimDuration` 均为既有状态，直接引用

2. **模板 UI**：在"裁剪时间轴"标题行"拖动时暂停"label 旁追加同风格 checkbox 开关（`v-model="keyboardShortcutsEnabled"`，文案如"快捷键模式"，title 提示说明 A/D/空格/回车含义），沿用 `accent-blue-500` 样式与既有 label 布局

### 性能与可靠性

- 无性能开销：键盘监听为既有单例，仅增加常量级分支判断
- 无副作用：开关关闭时所有新分支不执行，不影响现有方向键步进；`preventDefault` 仅作用于已匹配的快捷键按键
- 安全边界：输入类元素聚焦时被既有守卫拦截，裁剪进行中由 `cuttingInProgress` 守卫拦截，避免重复裁剪

## 目录结构

仅修改 1 个文件：

```
src/renderer/src/views/SplitMerge/SplitMergeView.vue  # [MODIFY] 新增 keyboardShortcutsEnabled ref、扩展 onKeydown 快捷键分支、添加开关 checkbox UI
```

## 代码结构（关键接口）

```ts
// 新增状态（script setup 内）
const keyboardShortcutsEnabled = ref(false)

// onKeydown 内新增分支（在现有 ArrowLeft/ArrowRight 之后，输入元素守卫与 videoPlayer 守卫之后）
if (keyboardShortcutsEnabled.value) {
  const key = e.key.toLowerCase()
  if (key === 'a') {
    e.preventDefault()
    snapStartHere()
  } else if (key === 'd') {
    e.preventDefault()
    snapEndHere()
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (!(trimDuration.value > 0 && !cuttingInProgress.value)) { return }
    e.preventDefault()
    cutToClipList()
  }
}
```