# Compress 模块冗余与逻辑审查

## 审查结论

Compress 模块经多轮重构后整体质量良好：useCompressBatch 已用 Map 将查找降为 O(n)、状态整体重建、进度监听器绑定组件生命周期、VideoDetailModal 已改为响应式 watch 驱动并加竞态守卫。本轮审查未发现高危逻辑缺陷，仅识别出若干低风险冗余与可硬化逻辑，列于下方。**遵循"不主动发起纯重构"原则，仅在确有收益处做最小改动。**

## 修复项

### 1. VideoDetailModal：`fetchMeta` then/catch 重复守卫（冗余）
- **文件**：`src/renderer/src/views/Compress/VideoDetailModal.vue` L23-33
- **问题**：`.then` 与 `.catch` 各自重复同一段 `if (!isUnmounted && props.entry === entry) detailLoading.value = false`，属典型样板重复。
- **改法**：合并为 `.finally(() => { if (!isUnmounted && props.entry === entry) detailLoading.value = false })`，`.then` 仅保留 `entry.meta = meta`，`.catch` 改为空捕获（注释说明静默）。
- **风险**：极低；finally 语义等价于原两分支。

### 2. VideoDetailModal：watch 切换/关闭时未复位 `detailLoading`（逻辑硬化，低优先）
- **文件**：`src/renderer/src/views/Compress/VideoDetailModal.vue` L49-58
- **现状**：watch 在 entry 变为 null（else 分支）时只移除 keydown 监听，不复位 loading；切到已有 meta 的新 entry 时也不复位。由于 `.detail-overlay` 全屏遮罩阻断了对文件表的点击，entry 切换在常规 UI 下不可达；但组件卸载/路由切换路径下仍可能残留 loading 态。
- **改法**：watch 回调首行按需复位：`if (!entry) { detailLoading.value = false; document.removeEventListener(...) return }`，并在有 meta 分支显式 `detailLoading.value = false`（无 meta 才置 true 并 fetch）。
- **风险**：低；纯防御性，不改变正常路径行为。

### 3. CompressView：结果列表 `:key="idx"`（冗余/正确性，低优先）
- **文件**：`src/renderer/src/views/Compress/CompressView.vue` L327-328
- **现状**：`compressResultRows` 的 v-for 用 index 作 key。结果列表为追加式、不重排，index key 可工作，但若后续支持重跑/清空再填充，index 复用会导致 diff 错位。
- **改法**：改为稳定复合 key `:key="`${item.fileName}-${item.originalSize}`"`（CompressResultItem 含 fileName/originalSize/compressedSize）。
- **风险**：极低。

### 4. useCompressBatch：catch 块遍历对象语义化（逻辑一致性，低优先）
- **文件**：`src/renderer/src/composables/useCompressBatch.ts` L244-248
- **现状**：catch 中遍历 `compressFiles.value`（实时列表）将 `pending` 标记为 `failed`。由于 prepareRun 整体重建状态表，运行中新增文件在 `fileStatuses` 中为 `undefined`，`=== 'pending'` 守卫已防止误标，**实际不会出错**；但语义上应遍历 `snapshot` 以明确"仅标记本次运行参与者"。
- **改法**：将 `for (const entry of compressFiles.value)` 改为 `for (const entry of snapshot)`。
- **风险**：极低；守卫已兜底，语义更清晰。

## 不做的事项（已审查确认无需改）

- **errorMsg 跨层写入**（CompressView L138 与 useCompressBatch 均写 errorMsg）：历史审查已标记为可接受设计，保持。
- **`buildBatchPayload` 内联返回类型** 与 preload `batchCompress` 文件结构重复：仅 2 处使用，未达 Rule of Three，不提取共享类型。
- **`selectQuickDir('source')` 不设 loadingPath**：sourceDir 为同步 computed，无加载态需求，保持。
- **CompressParams 直接 v-model 修改 props.params**：注释已标明"有意设计"（共享 reactive 对象），保持。
- **`_compress.scss` `.detail-overlay` 硬编码 `rgba(0,0,0,0.55)`**：属样式债务（codex 样式报告已记录类似项），非本轮"冗余与逻辑"范畴，不动。
- **`compressResultRows` 预计算**：合理优化，保持。

## 验证

- `npx vue-tsc --noEmit -p tsconfig.web.json` 类型检查通过
- 不执行 `npm run build`（项目规范禁止）；运行时表现由用户 `npm run dev` 验证：
  - 弹窗打开无 meta 文件 → 显示 loading → 关闭/重开 → loading 不残留
  - 压缩失败时仅本次运行文件标红，新增文件不受影响

## 关键文件

- `src/renderer/src/views/Compress/VideoDetailModal.vue`（主改）
- `src/renderer/src/views/Compress/CompressView.vue`（key 调整）
- `src/renderer/src/composables/useCompressBatch.ts`（catch 语义化）
- `src/renderer/src/views/Compress/CompressParams.vue`（仅审查，无改动）
- `src/renderer/src/views/Compress/types/index.ts`（仅审查，无改动）

## 被否决的方案

- **提取 `buildBatchPayload` 返回类型为共享 CompressFilePayload 接口**：仅 2 处使用，违反 Rule of Three，错误抽象比重复更难维护，否决。
- **VideoDetailModal 改回 defineExpose 命令式打开**：历史已从命令式重构为响应式 watch，回退会丢失竞态防护，否决。
- **useCompressBatch 拆分为独立 store**：当前模块级 ref 已满足跨页面持久需求，拆分增加文件无收益，否决。
- **对 `_compress.scss` 硬编码色值发起修复**：属样式审查范畴（已有 codex 报告跟踪），非本轮逻辑/冗余目标，否决以避免范围蔓延。