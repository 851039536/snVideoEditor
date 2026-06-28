---
name: refactor-gif-trim-architecture
overview: 将 GifConvertView 的 trim 响应式架构从「computed from string refs + watch 同步」重构为与 SplitMergeView 一致的「ref<number> 直接存储 + computed get/set 派生 HH:MM:SS」，从根本上修复手柄拖拽失效问题。
todos:
  - id: refactor-trim-model
    content: 将 GifConvertView 的 trim 数据模型重构为 ref
    status: completed
---

## 用户需求

GifConvertView 加载视频后，时间轴上的 trim 手柄无法拖拽移动。上轮修复已对齐 pointer 事件体系，但问题依旧存在。

## 根因分析

与正常工作的 SplitMergeView 对比，GifConvertView 存在架构级差异：

| 方面 | SplitMergeView（正常） | GifConvertView（失效） |
| --- | --- | --- |
| 时间值存储 | `trimStartSec = ref(0)`, `trimEndSec = ref(30)` | 6 个 `ref<string>`（startHour/Min/Sec...） |
| HH:MM:SS 字段 | `computed({ get, set })` 派生自 trimSec ref | 反向：trimStartSec/trimEndSec 是 computed 派生自字符串 ref |
| 拖拽更新 | 直接设置 `trimStartSec.value = clamped` | 设置字符串 ref → watch 触发 syncTrimFromInputs → clamp |
| 同步机制 | 无需额外同步 | `syncing` 标志 + `watch 6 refs` + `syncTrimFromInputs()` |
| 指针事件注册 | 模块顶层 `document.addEventListener` | `onMounted` 中注册 |


核心问题：字符串 ref → computed → watch → syncTrimFromInputs 的间接响应链导致拖拽时状态更新路径过长、不可靠。

## 修复目标

将 GifConvertView 的 trim 时间管理重构为与 SplitMergeView 一致的模式：使用 `ref<number>` 直存秒数，HH:MM:SS 字段用 `computed({get,set})` 派生。

## 技术方案

### 改动范围

仅修改 `src/renderer/src/views/Gif/GifConvertView.vue`，模板和样式无需改动。

### 具体变更

#### 1. 替换数据模型（约第40-98行）

删除 6 个字符串 ref（startHour/Min/Sec, endHour/Min/Sec）、`let syncing`、`syncTrimFromInputs()` 函数、`watch` 同步。
新增 2 个数字 ref：`trimStartSec = ref(0)`, `trimEndSec = ref(5)`。
新增 6 个 computed get/set 字段，模式如下：

```ts
const trimStartSec = ref(0)
const trimEndSec = ref(5)

function hmsFieldSetter(field: 'start' | 'end', h: string, m: string, s: string): void {
  const total = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
  if (isNaN(total)) { return }
  if (field === 'start') {
    trimStartSec.value = clamp(total, 0, trimEndSec.value - MIN_TRIM_GAP)
  } else {
    const max = maxDuration.value || 99999
    trimEndSec.value = clamp(total, trimStartSec.value + MIN_TRIM_GAP, max)
  }
}

const startHour = computed({
  get: () => secondsToHMS(trimStartSec.value).split(':')[0],
  set: (v: string) => hmsFieldSetter('start', v, startMin.value, startSec.value)
})
// ... startMin, startSec, endHour, endMin, endSec 同理
```

#### 2. 删除 trimStartSec/trimEndSec computed（约第55-61行）

原先的 `computed(() => hmsToSeconds(...))` 不再需要，因为现在它们已是 `ref<number>`。

#### 3. 简化 onTimelineMove（约第214-230行）

直接设置 `trimStartSec.value` / `trimEndSec.value`，不再通过字符串 ref：

```ts
function onTimelineMove(e: PointerEvent): void {
  if (!dragging.value) { return }
  const t = getTimelineTime(e.clientX)
  if (dragging.value === 'start') {
    trimStartSec.value = clamp(t, 0, trimEndSec.value - MIN_TRIM_GAP)
    seekVideoPlayer(trimStartSec.value)
  } else {
    trimEndSec.value = clamp(t, trimStartSec.value + MIN_TRIM_GAP, maxDuration.value)
    seekVideoPlayer(trimEndSec.value)
  }
}
```

#### 4. 调整元数据加载 watch（约第104-114行）

改为直接设置 `trimEndSec.value`（不再映射到字符串 ref）：

```ts
watch(() => files.value[0]?.meta, (meta) => {
  if (!meta || meta.duration <= 0) { return }
  maxDuration.value = meta.duration
  if (trimDuration.value <= 0 || trimEndSec.value > meta.duration) {
    trimEndSec.value = Math.min(5, meta.duration)
  }
})
```

#### 5. 指针事件注册改为模块顶层（约第239-247行）

参照 SplitMergeView，将 `onMounted`/`onUnmounted` 中的 pointer 注册改为模块顶层：

```ts
if (typeof window !== 'undefined') {
  document.addEventListener('pointermove', onGlobalPointerMove)
  document.addEventListener('pointerup', onGlobalPointerUp)
}

onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  window.electronAPI?.removeProgressListener()
})
```

合并原本分散的两个 `onUnmounted` 为一个。

#### 6. 新增 seekVideoPlayer 辅助函数

为消除 `onTimelineMove` 和 `hmsFieldSetter` 中的重复代码，新增辅助函数：

```ts
function seekVideoPlayer(t: number): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = t
    currentTime.value = t
  }
}
```

### 不变的部分

- 模板：`v-model` 绑定到 computed 字段（startHour/Min/Sec 等），名称不变
- 样式：无需改动
- 其他逻辑：startConvert、estimateOutputSize、togglePlay 等无需改动