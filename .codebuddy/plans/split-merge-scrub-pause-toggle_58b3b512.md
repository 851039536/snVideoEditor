---
name: split-merge-scrub-pause-toggle
overview: 在 SplitMergeView.vue 中增加"拖动时间轴时是否暂停播放"的可选开关，默认保持当前行为（暂停），用户可关闭开关使拖动时视频继续播放。设置通过 localStorage 持久化。
todos:
  - id: add-scrub-pause-toggle
    content: 在 SplitMergeView.vue 中新增 pauseOnScrub 开关：localStorage 持久化、修改 startScrub 条件暂停、模板添加 checkbox UI
    status: completed
---

## 用户需求

在 SplitMergeView.vue 的裁剪时间轴中，当前点击中线拖动（scrub）时会强制暂停视频播放。用户希望增加一个可选项开关，让用户自行决定拖动时间轴时是否暂停播放：

- 开关开启（默认）：拖动时暂停视频（保持当前行为）
- 开关关闭：拖动时不暂停，视频继续播放，播放头跟随拖动位置跳转后继续播放

设置需持久化到 localStorage，下次打开仍生效。

## 核心功能

- 在时间轴标题区域新增"拖动时暂停"开关
- 修改 `startScrub` 逻辑：仅当开关开启时才暂停视频
- 开关状态持久化到 localStorage

## 技术栈

- Vue 3.4 + TypeScript + Composition API（`<script setup lang="ts">`）
- localStorage 持久化（与项目现有 theme/compressPreset/playerData 模式一致）

## 实现方案

采用本地 ref + localStorage 持久化方式，不修改 settings store。理由：此设置仅影响 SplitMergeView 单一视图，不涉及跨功能共享，局部化更符合最小改动原则。

### 修改点

1. **Script 部分** — `SplitMergeView.vue`

- 新增 `SCRUB_PAUSE_KEY = 'snve-scrub-pause'` 常量
- 新增 `loadScrubPause(): boolean` 函数，从 localStorage 读取，默认 `true`
- 新增 `const pauseOnScrub = ref<boolean>(loadScrubPause())`
- 新增 `watch(pauseOnScrub, ...)` 持久化到 localStorage
- 修改 `startScrub`：将 `videoPlayer.value?.pause()` 和 `isPlaying.value = false` 两行包裹在 `if (pauseOnScrub.value)` 条件内

2. **Template 部分** — 时间轴标题行

- 在"裁剪时间轴"标题右侧添加紧凑的 checkbox + label，绑定 `pauseOnScrub`

### 行为分析

- `pauseOnScrub = true`（默认）：`startScrub` 暂停视频 → 拖动 seek → 释放后保持暂停（当前行为不变）
- `pauseOnScrub = false`：`startScrub` 不暂停 → `seekVideoPlayer` 设置 `currentTime` → 视频从新位置继续播放 → `onTimeUpdate` 中已有的 `trimEnd` 边界检查仍然生效，到达结束点自动暂停
- `onGlobalPointerUp` 无需修改：scrub 结束时若视频在播放则自然继续，若已暂停则保持暂停

## 实现注意事项

- `startScrub` 中的 `seekVideoPlayer(getTimelineTime(e.clientX))` 始终执行（无论是否暂停），确保点击即定位
- checkbox 使用 Tailwind utility class 样式，文字使用 `text-text-secondary text-xs`，不硬编码颜色
- `if` 语句必须带花括号（项目规范）