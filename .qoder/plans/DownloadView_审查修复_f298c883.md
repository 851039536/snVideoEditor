# DownloadView.vue 审查修复

## 修改范围
仅 `src/renderer/src/views/Download/DownloadView.vue` 单文件，5 处改动，不做整体拆分（795 行为备案技术债）。

## 1. 补文件头注释
最顶部添加：
```html
<!-- 视频下载页面：m3u8 解析、网页提取、清晰度选择与下载队列管理 -->
```

## 2. 提取 applyQueueStatus 消除三处重复
- script 中新增（中文注释）：
  ```ts
  /** 将后端队列状态同步到 progressStore */
  function applyQueueStatus(status: QueueStatus): void {
    progressStore.updateQueueItems(status.items);
    progressStore.queueActiveIds = status.activeIds;
    progressStore.queueIsProcessing = status.isProcessing;
    progressStore.queueConcurrency = status.concurrency;
  }
  ```
- 三处调用点替换：onQueueUpdate 回调（L506-L511）、onMounted 初始拉取（L524-L528）、handleQueueCancel 重同步（L470-L473，顺带补齐此前缺失的 concurrency 同步）
- 从 `@/types/file` 导入 `QueueStatus` 类型（getQueueStatus / onQueueUpdate 的返回结构即此类型，需确认 preload 签名一致，不一致则以 preload 实际类型为准）

## 3. 清除陈旧 fetchedTitle
`watch(m3u8Url)` 回调开头（自动填充文件名之前）添加：
```ts
// 手动输入的新地址与提取结果无关时，清除旧页面标题，避免污染自动文件名
if (url && !fetchedUrls.value.includes(url)) {
  fetchedTitle.value = '';
}
```
selectFetchedUrl 流程不受影响（所选 url 必在 fetchedUrls 中）。

## 4. selectQuickDir 按实际按钮类型判断
L205：`if (!commonPaths.value.desktop)` 改为 `if (!commonPaths.value[type])`，与 CompressView 此前的修复保持一致。

## 5. 清晰度探测防抖
- 新增模块级变量 `let variantFetchTimer: ReturnType<typeof setTimeout> | null = null;`
- `watch(m3u8Url)` 中直接调用 `fetchQualityVariants()` 处改为 400ms 防抖：
  ```ts
  if (variantFetchTimer) { clearTimeout(variantFetchTimer); }
  variantFetchTimer = setTimeout(() => { fetchQualityVariants(); }, 400);
  ```
- 文件名自动填充与 syncCookiesForUrl 保持即时执行不防抖
- onUnmounted 中清理该 timer（与 justEnqueuedTimer 并列）
- 既有 fetchVariantsVersion 版本号保护保留，防抖与竞态保护叠加

## 验证
- `npx vue-tsc --noEmit -p tsconfig.web.json` 类型检查通过
- 运行时（用户 npm run dev 验证）：提取页面 A 后手动粘贴无关 m3u8 地址，自动文件名不再带 A 的标题；逐字符编辑 URL 时变体请求延迟合并为一次

## 不做的事
- 不拆分文件（备案技术债，禁止主动纯重构）
- 不动 syncCookiesForUrl 的两处调用（看似重复实为必要，已有注释）
- 不批量翻译模板中的既有英文区块注释（仅本次触碰的位置顺带用中文）