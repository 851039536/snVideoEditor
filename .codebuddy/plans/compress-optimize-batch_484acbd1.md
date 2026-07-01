---
name: compress-optimize-batch
overview: 优化 CompressView 代码冗余（提取复用 Tooltip 组件、精简 watch 逻辑）并增强批量压缩兼容性（逐文件状态追踪、部分失败处理、当前文件名显示）。
todos:
  - id: extend-progress-types
    content: 扩展 ProgressInfo 和 ProgressCallback 类型，添加 currentFileName 可选字段（涉及 preload/index.ts、preload/index.d.ts、main/ffmpeg-shared.ts、main/ffmpeg-compress.ts 四处同步修改）
    status: completed
  - id: create-infotooltip-component
    content: 使用 [skill:Frontend Components] 创建 src/renderer/src/components/InfoTooltip.vue 通用 tooltip 组件，封装 useInfoTooltip composable，通过 label/content 具名 slot 传入差异内容
    status: completed
  - id: add-batch-types
    content: 在 Compress types/index.ts 中添加 BatchFileStatus 类型和 CompressFileEntry 接口
    status: completed
  - id: refactor-compress-view
    content: 重构 CompressView.vue：用 InfoTooltip 替换 5 个内联 tooltip、新增逐文件状态管理、优化 startCompress 拆分与部分失败处理、合并分散的 watch、升级 estimateOutputSize 估算、增强 canStart 校验
    status: completed
    dependencies:
      - create-infotooltip-component
      - add-batch-types
      - extend-progress-types
  - id: migrate-tooltip-styles
    content: 将 _compress.scss 中的 tooltip-fade 动画定义迁移到 InfoTooltip.vue scoped style，确保样式不丢失
    status: completed
    dependencies:
      - create-infotooltip-component
  - id: verify-compatibility
    content: 使用 [subagent:code-explorer] 搜索所有引用 ProgressInfo 的组件（ProgressPanel、SplitMergeView、GifConvertView、EncryptView 等），验证 optional 字段兼容性，确保无遗漏
    status: completed
    dependencies:
      - refactor-compress-view
---

## 用户需求

审查并重构 `src/renderer/src/views/Compress/` 模块，消除代码冗余，增强批量压缩场景的兼容性。

## 核心功能

### 代码冗余优化

- **提取 InfoTooltip 通用组件**：5 个重复的 tooltip HTML 结构（bitrateTip / codecTip / audioBitrateTip / presetTip / twoPassTip）提取为 `<InfoTooltip>` 组件，通过具名 slot 传入差异内容，减少约 200 行重复模板代码。
- **精简分散的 watch**：将 `watch(resolution)` + `watch(bitrate)` + `watch([crfValue, resolution, bitrate, codec, audioBitrate, preset, twoPass])` 三个 watch 合并为 2 个，消除冗余联动逻辑。
- **优化文件大小估算**：`estimateOutputSize` 在固定码率模式下按 bitrate × duration 计算，区分 H.265/H.264 压缩效率差异，提升估算准确度。
- **重组 `startCompress` 函数**：拆分为校验、执行、结果处理三个独立函数，降低单函数复杂度。

### 批量压缩兼容性增强

- **处理部分失败场景**：当 `batchCompress` 返回部分成功、部分失败时，同时展示成功文件的压缩结果对比和失败文件的错误信息。
- **逐文件处理状态**：文件列表表格新增状态列（等待中 / 处理中 / 已完成 / 失败），批量处理时实时更新每行状态。
- **进度显示当前文件名**：在 `ProgressInfo` 中新增 `currentFileName` 可选字段，主进程推送当前正在处理的文件名，ProgressPanel 在批量模式下展示文件名。
- **启动前校验输出路径**：`canStart` 计算属性同时检查所有文件是否已设置 outputPath，未设置时按钮保持禁用状态。

## 技术栈

- 框架：Vue 3.4 + Composition API + TypeScript 5
- 状态管理：Pinia（progress store）
- IPC：Electron contextBridge + wrapOperation 模式
- 样式：TailwindCSS + SCSS partials

## 实现方案

### 总体策略

遵循项目现有架构模式，最小化侵入性修改。核心思路：提取共享组件消除模板冗余 → 扩展 ProgressInfo 类型传递文件名 → 主进程推送当前文件名 → 渲染层展示逐文件状态并处理部分失败。

### 关键设计决策

**1. InfoTooltip 组件设计**

- 封装 `useInfoTooltip` composable 的使用（toggle / isOpen / elRef / click-outside 关闭），视图层只需传入 label 和 content slot
- 通过 `widthClass` prop 控制 tooltip 宽度（默认 `w-72`，编码格式 tooltip 使用 `w-80`）
- 组件放在 `src/renderer/src/components/` 目录，遵循"跨模块共享组件放 components/"的规则

**2. ProgressInfo 扩展**

- 在 `ProgressInfo` 接口添加 `currentFileName?: string` 可选字段，保持向后兼容
- 主进程 `batchCompress` 在循环处理每个文件时，通过 `onProgress` 回调额外推送 `currentFileName: path.basename(file.input)`
- `ProgressPanel` 在有 `currentFileName` 时展示文件名，替换或补充 "文件 N/M" 文本

**3. 逐文件状态管理**

- 在 CompressView 中维护 `fileStatuses: Ref<Record<string, BatchFileStatus>>` 映射表
- `BatchFileStatus` 类型：`'pending' | 'processing' | 'completed' | 'failed'`
- 开始压缩时全部设为 `pending`，根据进度事件中 `currentFileName` 匹配路径切换为 `processing`
- 结束后根据 `successFiles` / `failed` 设置对应状态

**4. 部分失败处理**

- 将结果处理逻辑从 if-else 改为：总是处理 `successFiles` 构建对比数据（如果有的话），单独处理 `failed` 构建错误提示
- 最终 errorMsg 只在有失败时设置，压缩结果对比在有成功文件时始终渲染

### 性能与兼容性

- `currentFileName` 为可选字段，不破坏现有 split/merge/encrypt 等操作的进度推送
- InfoTooltip 组件复用现有的 `useInfoTooltip` composable，不需要修改逻辑
- 文件状态映射使用 `Record<string, BatchFileStatus>`，查找 O(1)

## 实现要点

### 类型扩展（preload 双向同步）

`ProgressInfo`、`ProgressCallback` 分别定义在 preload/index.ts 和 main/ffmpeg-shared.ts，需保持同步。添加 `currentFileName?: string` 后两处均需更新。preload/index.d.ts 通过 `import type` 从 index.ts 导入，只需更新源文件。

### batchCompress 主进程改动

在 `ffmpeg-compress.ts` 的 `batchCompress` 函数循环中，对每个文件计算文件名并通过 `onProgress` 推送：

```ts
opts.onProgress({
  ...data,
  currentFile: i + 1,
  totalFiles: opts.files.length,
  currentFileName: path.basename(file.input)
})
```

### 组件迁移路径

从 CompressView.vue 中删除 5 个 `useInfoTooltip()` 调用（twoPassTip / codecTip / bitrateTip / audioBitrateTip / presetTip），模板中 5 处重复的 tooltip HTML 替换为 `<InfoTooltip>` 组件的 5 次使用。

### 样式处理

InfoTooltip 的 tooltip-fade transition 样式已存在于 `_compress.scss`，需将该 animation 移到全局样式或在 InfoTooltip 组件中复用。由于 InfoTooltip 是跨模块组件，选择将 tooltip-fade 定义在 InfoTooltip.vue 的 scoped style 中（约 8 行），同时从 `_compress.scss` 中移除重复定义。

## 架构设计

### 组件关系

```
CompressView.vue
├── FileDropZone          (已有，不变)
├── 文件列表表格           (新增状态列)
├── 参数面板
│   ├── InfoTooltip × 5   (新组件，替换内联 tooltip)
│   ├── 分辨率/码率/CRF/编码/音频/预设/2-Pass 控件
├── 输出设置面板
├── ProgressPanel         (已有，增强显示文件名)
└── 压缩结果对比          (已有，增强显示失败信息)
    VideoDetailModal.vue  (已有，不变)
```

### 数据流

```
用户点击开始压缩
  → startCompress() 校验 outputPath
  → 设置所有文件状态为 pending
  → IPC batchCompress() 调用
  → 主进程逐文件处理，onProgress 推送 { percent, currentFile, totalFiles, currentFileName }
  → 渲染进程: progressStore.update() + fileStatuses 更新
  → ProgressPanel 显示进度 + 当前文件名
  → 文件列表表格行根据 fileStatuses 显示状态图标
  → 完成后: successFiles → 压缩结果对比 / failed → 错误提示
```

## 目录结构

```
src/
├── main/modules/
│   ├── ffmpeg-shared.ts       # [MODIFY] ProgressCallback data 添加 currentFileName?: string
│   └── ffmpeg-compress.ts     # [MODIFY] batchCompress 推送 currentFileName
├── preload/
│   ├── index.ts               # [MODIFY] ProgressInfo 添加 currentFileName?: string
│   └── index.d.ts             # [MODIFY] 同步 ProgressInfo 类型（通过 import type 自动同步）
└── renderer/src/
    ├── components/
    │   └── InfoTooltip.vue     # [NEW] 通用 tooltip 组件，封装 useInfoTooltip + 模板结构，通过具名 slot 传入 label / content
    ├── views/Compress/
    │   ├── CompressView.vue    # [MODIFY] 主要重构文件：替换 tooltip 为 InfoTooltip，新增批量状态管理，优化 startCompress，合并 watch，升级 estimateOutputSize
    │   ├── VideoDetailModal.vue # (不变)
    │   └── types/
    │       └── index.ts        # [MODIFY] 添加 BatchFileStatus 类型、CompressFileEntry 类型
    └── assets/styles/
        └── _compress.scss      # [MODIFY] 移除 tooltip-fade 动画定义（已迁移到 InfoTooltip.vue）
```

## 关键代码结构

### BatchFileStatus 类型（types/index.ts 新增）

```ts
/** 批量压缩文件处理状态 */
export type BatchFileStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** 带压缩状态的 FileEntry 扩展 */
export interface CompressFileEntry {
  path: string
  outputPath: string
  meta: VideoMeta | null
  status: BatchFileStatus
}
```

### InfoTooltip 组件接口（components/InfoTooltip.vue）

```
<!-- Props -->
defineProps<{
  title?: string           // button title 属性
  widthClass?: string      // tooltip 宽度类，默认 'w-72'
}>()

<!-- Slots -->
<!-- #label: 标签文本（必填） -->
<!-- #content: tooltip 内容（必填，任意 HTML） -->
```

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：在整个项目中搜索所有引用 ProgressInfo、ProgressCallback、useInfoTooltip 的地方，确保修改不会遗漏调用点
- 预期结果：确认所有消费 ProgressInfo 的组件（ProgressPanel、SplitMergeView、GifConvertView、EncryptView 等）都能兼容新增的 optional 字段，不会因类型扩展而报错

### Skill

- **Frontend Components**
- 用途：设计 InfoTooltip.vue 组件，确保符合单职责、清晰接口、合理状态管理的组件设计原则
- 预期结果：产出可复用的、带完整 TypeScript 类型定义的 InfoTooltip.vue 组件，通过 slot 暴露 label 和 content 插槽