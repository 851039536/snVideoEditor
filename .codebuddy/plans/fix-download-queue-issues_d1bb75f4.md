---
name: fix-download-queue-issues
overview: 修复下载队列 4 个逻辑问题：终态项无法移除、fetchQualityVariants 双重调用、enqueueDownload 校验顺序错误、cancelQueueItem 返回值未处理。涉及后端队列管理器、IPC、preload、两个 Vue 组件。
todos:
  - id: fix-backend-remove
    content: 修改 download-queue.ts：removeItem 放宽守卫允许移除终态项，新增 clearTerminal() 方法
    status: completed
  - id: fix-ipc-preload
    content: main/index.ts 注册 clearTerminal handler + preload 新增 clearQueueTerminal API 和类型声明
    status: completed
    dependencies:
      - fix-backend-remove
  - id: fix-queue-ui
    content: DownloadQueue.vue 移除按钮覆盖终态 + 新增清空已完成按钮和 clearTerminal emit
    status: completed
    dependencies:
      - fix-ipc-preload
  - id: fix-view-logic
    content: DownloadView.vue 修复 selectFetchedUrl 冗余调用 + enqueueDownload 校验顺序 + handleQueueCancel 返回值 + handleClearTerminal
    status: completed
    dependencies:
      - fix-ipc-preload
---

## 产品概述

修复 Download 下载视图模块中审查发现的 4 个逻辑漏洞，涉及队列项清理、冗余 API 调用、校验顺序和返回值处理。

## 核心功能

- 允许移除已完成/失败/已取消状态的队列项（单个移除 + 批量"清空已完成"按钮）
- 消除 `selectFetchedUrl` 中 `fetchQualityVariants` 的冗余双重调用
- 修正 `enqueueDownload` 中 `looksLikeWebPage` 提示位置，避免被早期 return 吞没
- 处理 `cancelQueueItem` 返回值，失败时重新同步队列状态

## 技术栈

- Electron 31 + Vue 3.4 + TypeScript 5 + Pinia（现有项目，无需引入新依赖）
- 修改层级：主进程 `download-queue.ts` → IPC handler `main/index.ts` → preload 桥接 → 渲染进程组件

## 实现方案

### Fix 1：终态项移除（跨全栈改动）

**后端 `download-queue.ts`（第 91-99 行）**：

- 修改 `removeItem(id)` 守卫条件：从 `if (item.status !== 'pending')` 改为 `if (item.status === 'pending' || item.status === 'downloading')`，即仅禁止移除活跃项，允许移除三个终态项
- 新增 `clearTerminal(): number` 方法：用 `filter` 移除所有 `completed`/`failed`/`cancelled` 项，返回移除数量，调用 `notifyStatus()`

**后端 `main/index.ts`（第 278 行后）**：

- 新增 `ipcMain.handle('download:clearTerminal', () => queueManager.clearTerminal())`

**Preload `index.ts`（第 235 行后）+ `index.d.ts`（第 168 行后）**：

- 新增 `clearQueueTerminal: (): Promise<number> => ipcRenderer.invoke('download:clearTerminal')`
- 类型声明 `clearQueueTerminal: () => Promise<number>`

**前端 `DownloadQueue.vue`**：

- `defineEmits` 增加 `clearTerminal: []`
- 新增 computed `hasTerminalItems`：判断是否存在 `completed`/`failed`/`cancelled` 项
- 移除按钮条件从 `v-if="item.status === 'pending'"` 改为 `v-if="item.status !== 'downloading'"`（pending + 终态均可移除）
- 顶部 header 右侧新增"清空已完成"按钮：`v-if="hasTerminalItems"`，点击 emit `clearTerminal`

**前端 `DownloadView.vue`**：

- 新增 `handleClearTerminal()` 调用 `window.electronAPI.clearQueueTerminal()`
- `<DownloadQueue>` 标签增加 `@clear-terminal="handleClearTerminal"`

### Fix 2：消除 `fetchQualityVariants` 双重调用

`DownloadView.vue` 第 264-270 行 `selectFetchedUrl`：

- 移除末尾 `await fetchQualityVariants()`，仅保留 `m3u8Url.value = url` 等三行
- 由第 98-106 行 `watch(m3u8Url)` 自动触发，`isFetchingVariants` loading 态正确反映

### Fix 3：`enqueueDownload` 校验顺序

`DownloadView.vue` 第 277-308 行：

- 将 `looksLikeWebPage` 检查块（第 287-289 行）移到 `outputPath` 校验（第 290-293 行）之后
- 顺序变为：URL 校验 → outputPath 校验 → looksLikeWebPage 提示 → enqueue

### Fix 4：`cancelQueueItem` 返回值处理

`DownloadView.vue` 第 322-324 行 `handleQueueCancel`：

- 检查返回值，若 `false` 则调用 `getQueueStatus` 重新同步 store 状态

## 实现备注

- `removeItem` 放宽守卫后，前端 downloading 项显示取消按钮而非移除按钮，不会误调
- `clearTerminal` 返回移除数量，当前不做 toast 提示，保持最小改动
- 所有修改保持 TypeScript 严格模式兼容，遵循项目代码风格（if 必须带花括号、function 显式返回类型）

## 目录结构

```
src/
├── main/
│   ├── modules/
│   │   └── download-queue.ts       # [MODIFY] removeItem 放宽守卫 + 新增 clearTerminal() 方法
│   └── index.ts                     # [MODIFY] 注册 download:clearTerminal IPC handler
├── preload/
│   ├── index.ts                     # [MODIFY] 新增 clearQueueTerminal API 桥接
│   └── index.d.ts                   # [MODIFY] 新增 clearQueueTerminal 类型声明
└── renderer/src/
    └── views/Download/
        ├── DownloadView.vue         # [MODIFY] selectFetchedUrl 去冗余 + enqueueDownload 校验顺序 + handleQueueCancel 返回值 + handleClearTerminal
        └── DownloadQueue.vue         # [MODIFY] 移除按钮覆盖终态 + 清空已完成按钮 + clearTerminal emit
```