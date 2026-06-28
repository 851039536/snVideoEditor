---
name: download-view-code-review-and-refactor
overview: 审查 Download 模块的两个 Vue 组件代码，识别并消除冗余，提取可复用逻辑，并给出功能扩展建议。
todos:
  - id: fix-timer-leak
    content: 修复 justEnqueued setTimeout 在组件卸载时未清理的内存泄漏（DownloadView.vue）
    status: completed
  - id: sanitize-webpage-detect
    content: 净化 looksLikeWebPage 函数，移除成人网站硬编码关键词（DownloadView.vue）
    status: completed
  - id: extract-utils
    content: 在 utils/format.ts 新增 todayDateStr、truncateUrl、sanitizeFileName 工具函数
    status: completed
  - id: optimize-download-queue
    content: 优化 DownloadQueue.vue：truncateUrl 改用 utils 导入、statusConfig 改为模块常量、statusCount 改为单次遍历
    status: completed
    dependencies:
      - extract-utils
  - id: extract-use-headers
    content: 新建 composables/useHeaders.ts，从 DownloadView.vue 抽取 Headers 管理逻辑
    status: completed
  - id: optimize-download-view
    content: 优化 DownloadView.vue：替换重复日期代码、使用 useHeaders composable、isValidUrl 改为 computed
    status: completed
    dependencies:
      - fix-timer-leak
      - sanitize-webpage-detect
      - extract-utils
      - extract-use-headers
---

## 任务概述

对 `src/renderer/src/views/Download/` 目录下的代码进行全面审查，修复已识别的 Bug、消除冗余代码、轻量优化架构，并将功能扩展建议整理为文档。

## 核心目标

### Bug 修复（2 项）

- `justEnqueued` 的 `setTimeout` 在组件卸载时未清理，可能导致 Vue 在已卸载组件上更新状态
- `looksLikeWebPage` 函数硬编码了成人网站敏感关键词（missav/jable/jav/pornhub/xvideos/xhamster），既不安全也不专业

### 冗余消除（4 项）

- `new Date().toISOString().slice(0, 10).replace(/-/g, '')` 在 `autoFileName` 中重复出现了 3 次，提取为 `todayDateStr()` 工具函数
- `truncateUrl` 函数定义在 `DownloadQueue.vue` 组件内部，应移入 `utils/format.ts`
- `statusConfig` 使用 `computed(() => ({...}))` 包装纯常量对象，应改为模块级常量 `STATUS_CONFIG`
- `statusCount` 使用 `.filter().length` 创建临时数组，应改用 `reduce` 或预计算计数字典

### 架构优化（2 项）

- `DownloadView.vue` 600+ 行，将 HTTP Headers 管理逻辑（add/remove/applyUAPreset/buildHeaders）抽出为 `composables/useHeaders.ts`
- `isValidUrl(m3u8Url)` 在模板中直接作为函数调用，每次渲染都执行 `new URL()`，应改为 `computed`

### 功能扩展建议（仅输出文档）

- 批量 URL 粘贴（多行 URL 自动识别拆分）
- 下载历史记录持久化（失败/完成列表）
- 代理/网络设置
- 清晰度偏好可选配置
- 下载完成后自动操作链

## 技术方案

### 实现策略

采用最小侵入式优化：优先修复 Bug → 消除冗余 → 轻量架构调整。避免大规模重构，保持现有组件接口不变。

### 工具函数提取（utils/format.ts）

新增 3 个函数：

```
todayDateStr(): string
  返回 `YYYYMMDD` 格式日期字符串，替换 autoFileName 中 3 处重复代码

truncateUrl(url: string, maxLen?: number): string
  从 DownloadQueue.vue 迁移，默认截断 50 字符

sanitizeFileName(raw: string): string
  从 autoFileName computed 中提取文件名净化逻辑（过滤非法字符、空格转下划线等）
```

### Composable 提取（composables/useHeaders.ts）

将 DownloadView 中的 Headers 管理逻辑抽出：

```ts
export function useHeaders() {
  const headers = ref<HeaderEntry[]>([...])
  const UA_PRESETS = [...]
  
  function addHeader(): void
  function removeHeader(index: number): void
  function applyUAPreset(ua: string): void
  function buildHeaders(): Record<string, string>
  
  return { headers, UA_PRESETS, addHeader, removeHeader, applyUAPreset, buildHeaders }
}
```

### Bug 修复要点

**setTimeout 泄漏**：在 `onUnmounted` 中清理 `justEnqueued` 的定时器 ID。

**looksLikeWebPage 净化**：移除所有成人网站关键词，改为基于技术特征的检测：

- 如果 URL 包含 `.m3u8`、`.ts`、`/hls/`、`/dash/` → 不是网页（已有）
- 如果 URL 以 `.html`、`.htm`、`.php` 结尾 → 是网页（已有）
- 保留通用视频平台检测（youtube/bilibili/vimeo 等），移除特殊内容网站
- 兜底：非流媒体后缀的都按网页处理

### 性能优化

**statusCount**：改为在 computed 中一次性遍历计算所有状态计数：

```ts
const statusCounts = computed(() => {
  const counts = { pending: 0, downloading: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const item of store.queueItems) {
    counts[item.status]++
  }
  return counts
})
```

**isValidUrl 模板调用**：新增 `isInputUrlValid` computed，避免每次渲染执行 `new URL()`。

### 目录结构

```
src/renderer/src/
├── utils/
│   └── format.ts          # [MODIFY] 新增 todayDateStr, truncateUrl, sanitizeFileName
├── composables/
│   └── useHeaders.ts      # [NEW] HTTP Headers 管理逻辑
└── views/
    └── Download/
        ├── DownloadView.vue     # [MODIFY] Bug 修复 + 使用 composable + 工具函数
        └── DownloadQueue.vue    # [MODIFY] Bug 修复 + 使用工具函数 + statusConfig 常量化
```