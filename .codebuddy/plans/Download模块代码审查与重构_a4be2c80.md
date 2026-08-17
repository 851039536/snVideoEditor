---
name: Download模块代码审查与重构
overview: 对 Download 视图模块（DownloadView/DownloadQueue/WebPagePanel/WebPageEntryItem/useWebPageParse/types）做深度审查，合并跨文件重复代码、修复边界异常与死代码，并做小幅性能优化，严格保持现有业务逻辑不变。
todos:
  - id: extract-origin-headers
    content: 在 utils/url.ts 新增 buildOriginHeaders，并替换 DownloadView、useWebPageParse 三处重复逻辑
    status: completed
  - id: extract-duplicate-confirm
    content: 新建 utils/download.ts 提取 confirmIfDownloadDuplicate，替换 DownloadView、useWebPageParse 两处查重弹窗逻辑
    status: completed
  - id: use-dirname-remove-dead
    content: Use [skill:lsp-code-analysis] 确认引用后，DownloadView 与 WebPagePanel 改用 getDirName 并移除死状态 isFetchingVariants
    status: completed
  - id: fix-entry-item-cleanup
    content: 修复 WebPageEntryItem 定时器泄漏，补充 onUnmounted 清理并优化 selectedCount/isAllSelected 为 computed
    status: completed
---

## 产品概述

对 `src/renderer/src/views/Download/` 目录下的 TypeScript/Vue 代码进行定向质量审查与重构，在不改变现有下载业务行为的前提下，消除逻辑漏洞、边界异常、死代码与跨文件重复代码，并优化少量渲染性能。

## 核心功能

- 修复组件卸载后定时器未清理的潜在泄漏（`WebPageEntryItem.copyUrl` 的 `copiedTimer`）
- 移除仅在内部赋值、从未被读取的死状态 `isFetchingVariants`
- 提取三处完全一致的 Referer/Origin 请求头构造逻辑为共享工具函数
- 提取两处完全一致的下载历史查重与确认弹窗逻辑为共享工具函数
- 统一使用已有 `getDirName` 工具函数，替换两处内联 dirname 正则实现
- 将模板中反复遍历链接列表的普通函数改为 `computed`，减少重复计算
- 所有改动严格遵循 AGENTS.md 编码规范（中文文件头注释、if 带花括号、函数声明返回类型、严格模式）

## 边界与约束

- 必须保证现有下载入队、网页解析、清晰度选择、队列管理等业务逻辑与用户交互不变
- `DownloadView.vue` 属已备案技术债文件，禁止主动发起整文件拆分，仅做定向去重与缺陷修复
- 禁止执行 `npm run build`

## 技术栈

- Vue 3.4 + TypeScript 5（严格模式）+ Composition API `<script setup lang="ts">`
- Pinia 状态管理（`stores/progress.ts`、`stores/webPaths.ts`）
- 现有工具层 `@/utils/format`、`@/utils/url`、`@/utils/cookies`
- Electron preload 桥接 API（`window.electronAPI`）

## 实现方案

### 总体策略

采用「定向提取 + 局部修复」策略，不改动数据流与 IPC 契约，只消除跨文件重复并修复已确认的边界问题。提取遵循 AGENTS.md 的「Rule of Three」与 utils 提取判定标准：被 2 个以上文件使用的逻辑必须提取到 `utils/`。

### 关键决策

1. **`buildOriginHeaders(pageUrl: string): Record<string, string>`** 放入 `utils/url.ts`

- 理由：三处代码逻辑逐字一致（`new URL(pageUrl)` → `Referer`/`Origin`），且 `url.ts` 已有 `isValidUrl`，职责同为 URL 解析工具。
- 行为：解析失败时返回空对象，调用方直接 `Object.assign(headers, buildOriginHeaders(url))`，保持原「失败静默忽略」语义。

2. **`confirmIfDownloadDuplicate(fileName: string): Promise<boolean>`** 放入新建的 `utils/download.ts`

- 理由：两处查重 + 确认弹窗文案完全一致；返回 `true` 表示「无重复或用户确认重复下载」，`false` 表示「用户取消」。
- 调用方差异保留：`DownloadView` 取消时设置 `hintMsg` 并 `return`；`useWebPageParse` 取消时 `result.skipped++` 并 `continue`。

3. **`getDirName` 复用**：`DownloadView.openHistoryFolder` 与 `WebPagePanel.openPathsFolder` 均改用 `@/utils/format` 已导出的 `getDirName`，删除内联正则。
4. **死状态移除**：`isFetchingVariants` 仅 3 处赋值、零读取，安全删除。
5. **定时器清理**：`WebPageEntryItem` 引入 `onUnmounted`，清理 `copiedTimer`，与 `DownloadView` 既有清理模式对齐。
6. **计算属性化（低风险性能优化）**：`selectedCount`/`isAllSelected` 由普通函数改为 `computed`，复用 Vue 缓存避免每次渲染重复遍历 `state.links`。

### 实现说明

- 三处 `buildOriginHeaders` 替换保持 `try/catch` 语义：函数内部已吞掉 URL 解析异常，调用方可移除原 try/catch 包裹。
- `utils/download.ts` 需要 `window.electronAPI.checkDownloadDuplicate` 与 `confirmDialog`，仅在渲染进程 utils 中调用，符合「统一入口」原则。
- 所有 `.ts` 新文件顶部添加中文职责注释；修改文件顺带确保文件头注释存在且为中文。
- `fetchQualityVariants` 中移除 `isFetchingVariants` 后，竞态保护逻辑（`fetchVariantsVersion`）保持不变。
- 不涉及样式与 UI 视觉变更，无需设计稿。

## 架构设计

保持现有分层：视图组件 → utils（纯函数工具）→ preload electronAPI。本次仅将散落在视图/composable 中的重复纯逻辑下沉到 utils，不新增架构模式、不改 IPC 通道、不改类型定义。

## 目录结构

```
src/renderer/src/utils/
├── url.ts               # [MODIFY] 新增 buildOriginHeaders：由页面 URL 生成 Referer/Origin 请求头
├── download.ts          # [NEW] 下载通用工具：confirmIfDownloadDuplicate 下载历史查重与确认
src/renderer/src/views/Download/
├── DownloadView.vue     # [MODIFY] 复用 buildOriginHeaders/confirmIfDownloadDuplicate/getDirName；删除死状态 isFetchingVariants
├── WebPagePanel.vue     # [MODIFY] openPathsFolder 改用 getDirName
├── WebPageEntryItem.vue # [MODIFY] copiedTimer 增加 onUnmounted 清理；selectedCount/isAllSelected 改为 computed
└── useWebPageParse.ts   # [MODIFY] buildHeadersForLink 复用 buildOriginHeaders；enqueueSelected 复用 confirmIfDownloadDuplicate
```

## 关键代码结构

```ts
// utils/url.ts 新增
export function buildOriginHeaders(pageUrl: string): Record<string, string>;

// utils/download.ts 新增
export async function confirmIfDownloadDuplicate(fileName: string): Promise<boolean>;
```

## Agent Extensions

### Skill

- **lsp-code-analysis**
- 用途：在执行移除 `isFetchingVariants` 等改动前，通过 LSP 语义分析确认符号无外部引用，并校验 `buildOriginHeaders`/`confirmIfDownloadDuplicate` 的调用点替换完整。
- 预期结果：获得可靠的引用清单与影响范围，确保不遗漏调用点、不误删仍被使用的代码。