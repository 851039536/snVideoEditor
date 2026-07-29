# VideoDetailModal.vue 审查修复

## 修改范围
- `src/renderer/src/views/Compress/VideoDetailModal.vue`（主要）
- `src/renderer/src/views/Compress/CompressView.vue`（联动简化）

## 1. VideoDetailModal.vue：watch 驱动 + Escape 修复

script 部分重构：

- 新增 `watch(() => props.entry, ...)`（导入 `watch`），替代命令式 `onOpen`：
  - entry 变为非 null 且无 meta 时调用 `fetchMeta(entry)`
  - entry 非 null 时在 `document` 上注册 keydown 监听（Esc 调 `close()`），变 null 时移除；`onUnmounted` 兜底移除
- 删除 `onOpen` 函数、`defineExpose({ onOpen })` 及 L34 与实现不符的注释；相关注释改为中文并如实描述 watch 行为
- `fetchMeta` 回调中清除 `detailLoading` 前校验 `props.entry === entry`，避免旧请求提前清除新弹窗的 loading（`entry.meta = meta` 缓存写入保留，不受此校验限制）
- 模板：移除 overlay 上无效的 `@keydown.escape="close"`；`role="dialog"` 处补充 `aria-modal="true"`

## 2. CompressView.vue：删除命令式调用链

- 删除 `detailModalRef` ref 及模板上的 `ref="detailModalRef"`
- `openDetail` 简化为仅 `detailEntry.value = entry`，删除 `nextTick` 回调
- 若 `nextTick` 再无其他使用处，从 vue 导入中移除

## 验证
- `npx vue-tsc --noEmit -p tsconfig.web.json` 类型检查通过
- 运行时（用户 `npm run dev` 自行验证）：点击文件行 Info 按钮弹窗正常打开并拉取元信息；按 Esc 可关闭；快速切换两个文件无 loading 闪烁

## 不做的事
- 不实现完整 focus trap（成本与收益不匹配，仅补 aria-modal 属性）
- 不改 `entry.meta` 写回共享列表的缓存设计（有意行为）