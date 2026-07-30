# types/file.ts 审查修复

## 修改范围
- `src/renderer/src/types/file.ts`（主要）
- `src/preload/index.ts`（仅更新一段注释）

## 1. 队列类型改为从 preload 重新导出（消除渲染侧重复）
删除 file.ts L22-L48 的本地定义（`QueueStatusType` / `QueueItem` / `QueueStatus` 及 "single source of truth" 注释块），替换为：

```ts
// ─── 下载队列共享类型 ─────────────────────────────────────────────
// 从 preload 重新导出（与 VideoMeta 同模式）；后端 download-queue.ts 的
// QueueItem 为含主进程私有字段的超集，二者字段需保持对齐。
export type {
  QueueStatusType,
  QueueItemDTO as QueueItem,
  QueueStatusDTO as QueueStatus
} from '../../../preload/index';
```

- 导出名不变，`progress.ts`、`DownloadView.vue` 等所有导入方零改动
- `QueueItem.cacheDir` 的 JSDoc 说明已存在于后端定义，preload DTO 侧不重复补

## 2. 补文件头注释
L1 之前添加：

```ts
// 渲染进程共享类型：文件条目、分割片段、下载队列与下载页类型（部分自 preload 重新导出）
```

## 3. 其余英文注释中文化
- L26 `/** Lifecycle status ... */` 随第 1 项删除
- L50 区块注释 → `// ─── 下载页共享类型 ─────────────────────────────`
- L52 → `/** 从 master playlist 解析出的可选 m3u8 清晰度变体 */`
- L61 → `/** 从浏览器会话提取的原始 Cookie，按 (domain, name) 区分 */`

## 4. preload/index.ts 对齐注释更新
L37-L39 注释改为（不再提 file.ts，因其已变为 re-export）：

```ts
// 下载队列 DTO：渲染侧唯一类型来源（types/file.ts 从此处重新导出）。
// 字段需与后端 src/main/modules/download-queue.ts 的 QueueItem/QueueStatus 保持对齐。
```

注意：`preload/index.d.ts` 中的同名类型双份为 preload 既有架构约定，本次不动。

## 不做的事（备案）
- `QualityVariant` / `RawCookie` 不迁移到 `views/Download/types/`：仅 1 处使用，迁移收益低
- 后端 `download-queue.ts` 的超集定义保持独立：进程边界正常形态
- `'../../../preload/index'` 深相对路径为既有模式，不引入新 alias

## 验证
运行 `npx vue-tsc --noEmit -p tsconfig.web.json` 确认渲染侧类型无回归（重命名 re-export 与原定义字段完全一致，预期通过）。