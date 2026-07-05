---
name: splitmerge-refactor
overview: 审查并清理 SplitMerge 模块冗余代码，修复裁剪完成后 video 元素持续占用渲染线程/文件句柄的问题：裁剪时暂停视频、裁剪后保持暂停；同时清理 canMerge 重复 filter、trimEnd 初始化分散、loadVideoMeta/onVideoLoaded 重复 seek、startProcess 进度监听未清理等冗余。
todos:
  - id: fix-video-pause
    content: 修复 cutToClipList 裁剪时暂停 video 播放器，释放渲染线程占用
    status: completed
  - id: refactor-redundancy
    content: 清理冗余：canMerge 复用 selectedClipCount、移除 isInitialTrimEnd、移除重复 seek、清理进度监听、移除单次 computed
    status: completed
    dependencies:
      - fix-video-pause
---

## 用户需求

针对 `src/renderer/src/views/SplitMerge` 模块进行两项工作：

1. **审查冗余代码**：识别并清理 SplitMergeView.vue 中的冗余逻辑（重复计算、分散的状态标志、多余的 computed、未清理的监听器等）
2. **修复"裁剪完成视频还在占用线程"问题**：裁剪操作完成后，渲染进程的 `<video>` 元素仍在播放/解码，导致 `onTimeUpdate` 高频触发、computed 重算、模板更新，渲染线程持续占用

## 问题概述

- **线程占用根因**：`cutToClipList()` 启动裁剪时未暂停 video 播放器，裁剪成功后重置 trim 位置但仍未暂停。若裁剪前视频正在播放，裁剪完成后 video 从头继续播放，`onTimeUpdate` 持续触发 `currentTime` 更新 → `playheadPercent` / `playheadInSelectionPercent` computed 重算 → 模板高频更新，渲染线程持续占用
- **冗余问题**：`canMerge` 重复 filter、`isInitialTrimEnd` 标志位分散管理、`loadVideoMeta` 与 `onVideoLoaded` 重复 seek、`startProcess` 完成后未清理进度监听器、`startTimeStr`/`endTimeStr` computed 仅用一次

## 修复范围

- 仅修改 `SplitMergeView.vue`，不改动 `ClipList.vue`（审查后无冗余）
- 不改动主进程代码（ffmpeg 进程清理逻辑正确，lock.ts 超时问题为全局隐患不在本次范围）

## 技术栈

基于现有项目技术栈，无需引入新依赖：

- Vue 3.4 + Composition API (`<script setup lang="ts">`)
- Pinia store (`stores/progress.ts`)
- Electron IPC (`window.electronAPI`)

## 实现方案

### 修复 1：裁剪时暂停 video，释放线程占用（核心）

**问题**：`cutToClipList()`（:434-481）启动裁剪时未暂停 `videoPlayer`，裁剪成功后（:472-474）重置 trim 位置但未暂停播放。

**方案**：

- 函数开始时（`cuttingInProgress.value = true` 之后）：调用 `videoPlayer.value?.pause()` 确保 video 停止解码
- `pause()` 会触发 `onVideoPause`（:278-280）自动设 `isPlaying = false`
- 裁剪成功后保持暂停，仅 `seekVideoPlayer(0)` 定位到开头便于继续裁剪
- 裁剪失败/取消同样保持暂停（无需额外处理，已暂停）

**性能影响**：裁剪完成后 video 不再播放 → `onTimeUpdate` 不再高频触发 → `currentTime` 不再更新 → `playheadPercent` / `playheadInSelectionPercent` computed 不再重算 → 模板不再高频更新 → 渲染线程释放。

### 修复 2：canMerge 复用 selectedClipCount

**问题**：`canMerge`（:129-132）内部重新 `clips.value.filter(c => c.selected)`，与 `selectedClipCount`（:134-136）重复计算。

**方案**：

```ts
const canMerge = computed((): boolean => {
  return selectedClipCount.value + files.value.length >= 2
})
```

注意：需确保 `selectedClipCount` 在 `canMerge` 之前定义（当前顺序已满足，:134 在 :129 之后，需调整声明顺序或将 canMerge 移到 selectedClipCount 之后）。

### 修复 3：合并 trimEnd 初始化逻辑，移除 isInitialTrimEnd

**问题**：`isInitialTrimEnd` 标志位在 7 处被读写（:43 声明、:57 设 false、:181 读取判断、:218 设 false、:333 设 false、:365 设 false、:419 设 false），管理分散、语义模糊。

**方案**：

- 移除 `isInitialTrimEnd` ref（:43）及其所有赋值
- `loadVideoMeta`（:216-218）直接设 `trimStartSec.value = 0; trimEndSec.value = meta.duration`，移除 `isInitialTrimEnd.value = false`
- `watch(duration)`（:179-185）简化为仅 clamp：当新 duration 小于当前 trimEnd 时将 trimEnd 收缩到 duration

```ts
watch(duration, (newDur) => {
if (newDur > 0 && trimEndSec.value > newDur) {
trimEndSec.value = newDur
}
})
```

- `snapEndHere`（:332-335）、`onHandleWheel('end')`（:365）、`hmsFieldSetter('end')`（:57）中移除 `isInitialTrimEnd.value = false`
- `onGlobalPointerMove` 中 end handle 拖拽（:419）移除 `isInitialTrimEnd.value = false`

### 修复 4：移除 loadVideoMeta 冗余 seek

**问题**：`loadVideoMeta`（:222-223）手动 `videoPlayer.value.load()` + `videoPlayer.value.currentTime = 0`，随后 `loadedmetadata` 事件触发 `onVideoLoaded`（:305-307）又 `seekVideoPlayer(trimStartSec.value)`，前者被后者覆盖。

**方案**：

- 移除 `loadVideoMeta` 中 `videoPlayer.value.currentTime = 0`（:223）
- 保留 `videoPlayer.value.load()`（触发 loadedmetadata → onVideoLoaded 统一 seek 到 trimStartSec）
- 保留 `currentTime.value = 0`（:219，响应式状态初始化）

### 修复 5：startProcess 完成时清理进度监听

**问题**：`startProcess`（:542-544）注册 `onProgress` 后，合并成功（:562）/失败（:564）/异常（:568）三处均未 `removeProgressListener()`，仅依赖 `onUnmounted`（:598）兜底。

**方案**：

- 合并成功 `store.finish()` 后（:562）、失败 `store.reset()` 后（:564）、异常 `store.reset()` 后（:568），三处均添加 `window.electronAPI.removeProgressListener()`
- `onUnmounted` 中的 `removeProgressListener()`（:598）保留作为兜底

### 修复 6（可选）：移除 startTimeStr/endTimeStr computed

**问题**：`startTimeStr`（:113-115）/`endTimeStr`（:117-119）computed 仅在模板 time markers（:817-819）使用一次。

**方案**：

- 删除 :113-119 两个 computed
- 模板 :817-819 直接使用 `secondsToHMS(trimStartSec)` / `secondsToHMS(trimEndSec)`

## 实现注意事项

- **声明顺序**：修复 2 中 `canMerge` 依赖 `selectedClipCount`，需确保后者在前者之前声明。当前 `canMerge`（:129）在 `selectedClipCount`（:134）之前，需将 `selectedClipCount` 移到 `canMerge` 之前，或将 `canMerge` 移到 `selectedClipCount` 之后。推荐将 `selectedClipCount` 上移到 `canMerge` 之前。
- **向后兼容**：所有修改均为渲染进程内部逻辑优化，不改变 IPC 接口、不改变用户操作流程、不改变功能行为，仅减少冗余和修复线程占用。
- **影响范围**：仅 `SplitMergeView.vue` 一个文件，`ClipList.vue` 不改动。
- **锁超时风险提示**：`lock.ts` 30s 超时仅 `releaseLock()` 不 kill `currentProc`，大文件裁剪可能产生孤儿进程。此为全局隐患，影响所有操作模块，不在本次 SplitMerge 范围内，仅作风险记录。

## 目录结构

```
src/renderer/src/views/SplitMerge/
├── SplitMergeView.vue   # [MODIFY] 修复裁剪时 video 未暂停、清理 6 处冗余
└── ClipList.vue          # [不变] 审查后无冗余，不改动
```