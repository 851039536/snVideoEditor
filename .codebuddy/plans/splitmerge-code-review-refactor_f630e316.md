---
name: splitmerge-code-review-refactor
overview: 审查 SplitMerge 目录的 JS/TS 代码，合并冗余逻辑、优化性能，确保不改变现有行为且符合 CLAUDE.md 规范（if 必须带花括号等）。
todos:
  - id: create-time-util
    content: 新建 src/renderer/src/lib/time.ts，导出 secondsToHMS 共享函数
    status: completed
  - id: extract-seek-helper
    content: 在 SplitMergeView.vue 新增 seekVideoPlayer(t) 辅助函数，替换全部 11 处调用点
    status: completed
  - id: dedupe-hms
    content: SplitMergeView.vue 和 ClipList.vue 都改为从 @/lib/time 导入 secondsToHMS，删除本地定义
    status: completed
    dependencies:
      - create-time-util
  - id: merge-pointer-move-branches
    content: 重构 onGlobalPointerMove：将 3 个分支中重复的 start/end 子判断与末尾 apply 块合并为统一结构
    status: completed
    dependencies:
      - extract-seek-helper
  - id: extract-swap-array
    content: 抽取 swapArrayElements 通用函数，替换 moveFile 和 moveClip 重复逻辑
    status: completed
  - id: optimize-timeupdate
    content: 优化 onTimeUpdate：仅在未到达裁剪终点时赋值 currentTime，消除冗余覆盖
    status: completed
---

## 代码精简目标

对 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 和 `ClipList.vue` 的 TypeScript/JavaScript 逻辑进行结构化重构，消除重复代码、提升可维护性，确保零逻辑变更。

## 重构范围

1. **提取 seekVideoPlayer(t) 辅助函数** — 消除 11+ 处相同的 `if(videoPlayer) { videoPlayer.currentTime=t; currentTime=t }` 模式
2. **统一 secondsToHMS 到共享模块** — SplitMergeView 和 ClipList 各定义一份完全相同的函数，新建 `src/renderer/src/lib/time.ts` 集中管理
3. **合并 onGlobalPointerMove 双层 start/end 判断** — 3 个分支各判断一次 + 末尾再判断一次，合并为一层
4. **抽取 swapArrayElements 通用函数** — moveFile 和 moveClip 的数组元素交换逻辑完全一致
5. **优化 onTimeUpdate 冗余赋值** — 裁剪终点处先设 currentTime 再立即覆盖，避免多余响应式更新

## 技术方案

### 1. 提取 seekVideoPlayer 辅助函数

在 SplitMergeView.vue 的 Helpers 区域新增：

```ts
function seekVideoPlayer(t: number): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = t
    currentTime.value = t
  }
}
```

替换 11 处调用点：

- `seekToStart()`: `videoPlayer.value.currentTime=trimStartSec.value; currentTime.value=trimStartSec.value` → `seekVideoPlayer(trimStartSec.value)`
- `seekToEnd()`: 同上 → `seekVideoPlayer(trimEndSec.value)`
- `stepBackward()`: 计算 t 后 → `seekVideoPlayer(t)`
- `stepForward()`: 同上
- `onHandleWheel('start')`: `videoPlayer.value.currentTime=trimStartSec.value; currentTime.value=trimStartSec.value` → `seekVideoPlayer(trimStartSec.value)`
- `onHandleWheel('end')`: 同上 → `seekVideoPlayer(trimEndSec.value)`
- `onGlobalPointerMove` start 分支: 同上 → `seekVideoPlayer(trimStartSec.value)`
- `onGlobalPointerMove` end 分支: 同上 → `seekVideoPlayer(trimEndSec.value)`
- `onTimelineClick`: 计算 t 后 → `seekVideoPlayer(t)`
- `onVideoLoaded`: 同上 → `seekVideoPlayer(trimStartSec.value)`
- `syncTrimFromInputs`: 同上 → `seekVideoPlayer(trimStartSec.value)`

### 2. 统一 secondsToHMS 到共享模块

- 新建 `src/renderer/src/lib/time.ts`，导出：

```ts
export function secondsToHMS(totalSec: number): string { ... }
```

- SplitMergeView.vue: 删除本地 `secondsToHMS`，改为 `import { secondsToHMS } from '@/lib/time'`
- ClipList.vue: 删除本地 `secondsToHMS`，改为 `import { secondsToHMS } from '@/lib/time'`

### 3. 合并 onGlobalPointerMove 双层分支

当前结构（L430-482）：

```
if (shift) { if start { clamp } else { clamp }; lastDragClientX=... }    // 第一层判断
else if (long) { if start { clamp } else { clamp }; lastDragClientX=... } // 第一层判断
else { t = getTimelineTime(...) }                                         // 无 start/end 判断

if (start) { if (t!==trim) { assign; seek }} else { ... }                 // 第二层判断（冗余）
```

重构后：三层中统一先计算 delta/absolute 得到 rawT，然后在**唯一一处**做 start/end 的 clamp + assign + seek：

```ts
// Step 1: compute raw value
let rawT: number
let updateLastX = false
if (e.shiftKey) {
  rawT = 当前值 + (e.clientX - lastDrag) * nativeRes / FINE_DRAG_SCALE
  updateLastX = true
} else if (nativeRes > MAX) {
  rawT = 当前值 + (e.clientX - lastDrag) * MAX_SECONDS_PER_PX
  updateLastX = true
} else {
  rawT = getTimelineTime(e.clientX)
}
if (updateLastX) { lastDragClientX.value = e.clientX }

// Step 2: apply (single start/end branch)
if (dragging.value === 'start') {
  const t = clamp(rawT, 0, trimEndSec.value - 0.1)
  if (trimStartSec.value !== t) { trimStartSec.value = t; syncManualToTrim(); seekVideoPlayer(t) }
} else {
  const t = clamp(rawT, trimStartSec.value + 0.1, duration.value)
  if (trimEndSec.value !== t) { trimEndSec.value = t; syncManualToTrim(); seekVideoPlayer(t) }
}
```

注意事项：Shift 和 LongVideo 分支的 rawT 使用 `trimStartSec.value + delta` 或 `trimEndSec.value + delta`，而 absolute 分支 rawT 来自绝对位置。因此 rawT 计算时需要根据 `dragging.value` 取不同的基础值。这要求 rawT 的计算仍需引用当前 trim 值。实现时保持 3 个分支的 t 计算，但移除去重后的第二层判断。

更简洁的方案：仍保留 3 个分支各自计算 t，但末尾合并为一个 apply 块：

```
let t: number
if (shift) { ... t = clamp(...) }
else if (long) { ... t = clamp(...) }
else { t = getTimelineTime(...) }

// 统一 apply（不区分模式）
if (dragging.value === 'start') {
  const clamped = clamp(t, 0, trimEndSec.value - 0.1)
  if (trimStartSec.value !== clamped) { trimStartSec.value = clamped; syncManualToTrim(); seekVideoPlayer(clamped) }
} else {
  const clamped = clamp(t, trimStartSec.value + 0.1, duration.value)
  if (trimEndSec.value !== clamped) { trimEndSec.value = clamped; syncManualToTrim(); seekVideoPlayer(clamped) }
}
```

此方案将 apply 块统一，消除 shift/long 分支内的重复 start/end 子判断，并保留 absolute 分支必要的后置 clamp。

### 4. 抽取 swapArrayElements 通用函数

在 SplitMergeView.vue 新增：

```ts
function swapArrayElements<T>(arr: T[], index: number, direction: -1 | 1): boolean {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= arr.length) { return false }
  const temp = arr[index]
  arr[index] = arr[newIndex]
  arr[newIndex] = temp
  return true
}
```

- `moveFile`: 改为 `swapArrayElements(files.value, index, direction)`
- `moveClip`: 改为 `swapArrayElements(clips.value, index, direction)`

### 5. 优化 onTimeUpdate 冗余赋值

当前 L309-319：

```ts
function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  currentTime.value = videoPlayer.value.currentTime          // L311: 始终赋值
  if (currentTime.value >= trimEndSec.value) {               // L313
    videoPlayer.value.pause()
    videoPlayer.value.currentTime = trimEndSec.value
    currentTime.value = trimEndSec.value                      // L316: 到达终点时覆盖 L311
    isPlaying.value = false
  }
}
```

优化为仅在未到达终点时赋值：

```ts
function onTimeUpdate(): void {
  if (!videoPlayer.value) { return }
  const t = videoPlayer.value.currentTime
  if (t >= trimEndSec.value) {
    videoPlayer.value.pause()
    videoPlayer.value.currentTime = trimEndSec.value
    currentTime.value = trimEndSec.value
    isPlaying.value = false
  } else {
    currentTime.value = t
  }
}
```

## 涉及文件

| 文件 | 操作 | 说明 |
| --- | --- | --- |
| `src/renderer/src/lib/time.ts` | **NEW** | 共享时间工具函数 `secondsToHMS` |
| `src/renderer/src/views/SplitMerge/SplitMergeView.vue` | MODIFY | 5 项重构 |
| `src/renderer/src/views/SplitMerge/ClipList.vue` | MODIFY | 替换 secondsToHMS 为导入 |