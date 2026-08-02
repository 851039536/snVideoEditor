# ColorAdjust 冗余修复

## 修改文件

`src/renderer/src/views/ColorAdjust/ColorAdjustView.vue`

## 改动 1：复用 useVideoPlayer composable

- 删除手动的 `videoPlayer` ref、`isPlaying` ref、`togglePlay`、`onVideoEnded`（第 21-43 行）
- import 并调用 `useVideoPlayer()`，解构 `videoPlayer`、`isPlaying`、`togglePlay`、`onVideoPlay`、`onVideoStop`
- 模板 `<video>` 标签：`@ended="onVideoEnded"` → `@ended="onVideoStop"`，并补充 `@play="onVideoPlay" @pause="onVideoStop"`
- `startAdjust` 中暂停预览的代码（第 78-81 行）改用 composable 的 `videoPlayer` ref，逻辑不变

## 改动 2：合并单文件/批量分支

- 删除单文件 `if (files.value.length === 1)` 分支（第 87-99 行），统一走 `batchAdjustColor`
- 构造 `batchFiles` 数组后直接调用 `window.electronAPI.batchAdjustColor({ files: batchFiles })`
- 结果判断统一为 `result.failed.length === 0` → finish，否则 reset + 错误提示

## 改动 3：修正 progressStore 终态守卫

- 删除两处 `if (!progressStore.isProcessing) { return }`（第 94、107 行）
- `finish`/`reset` 无条件执行，符合 AGENTS.md 进度终态与 UI 解耦规则

## 不改动项

- `useColorParams.ts`：`applyPreset`/`resetParams` 逐字段赋值保留
- `ffmpeg-color.ts`：单文件/批量两个导出函数保留（主进程层不做合并，仅视图层简化）
- `onSelectPreset`/`onResetParams` 薄包装保留

## 预期效果

ColorAdjustView.vue 从 350 行降至约 320 行，消除一处重复逻辑源，视频播放行为与 SplitMerge/Gif 保持一致。