---
name: splitmerge-code-optimization
overview: 优化 SplitMergeView.vue 中 10 个代码逻辑问题，重点解决手动输入同步的循环守卫脆弱性、duration 魔数、merge 后 clip 残留竞态、以及错误处理缺失等隐患。
todos:
  - id: p0-manual-sync
    content: 重构手动输入同步：将 startHour/Min/Sec 和 endHour/Min/Sec 从 ref 改为 computed（getter 从 trimStartSec/trimEndSec 派生，setter 写回秒数并 seek），删除 syncingFromTrim 标志、syncManualToTrim、syncTrimFromInputs 和 2 个 watcher
    status: completed
  - id: p0-magic-number
    content: 消除 duration watch 中的魔数 30：新增 isInitialTrimEnd ref，替换 trimEndSec.value === 30 硬编码判断
    status: completed
    dependencies:
      - p0-manual-sync
  - id: p1-addfiles-clips-cleanup
    content: 修复 addFiles 竞态（递增请求 ID 序列化 loadVideoMeta）+ merge 成功后从 clips 数组移除已处理条目 + loadFirstFileOnly 冗余检查
    status: completed
    dependencies:
      - p0-magic-number
  - id: p2p3-small-fixes
    content: 修复 P2/P3 问题：removeClip 改为 async/await + canStart 拆分为 canMerge + 移除 endedGuard + hmsToSeconds NaN 入口校验 + onUnmounted 可选链改为显式判断
    status: completed
    dependencies:
      - p1-addfiles-clips-cleanup
---

## 产品概述

对现有的 `SplitMergeView.vue`（视频分割与合并页面）及其子组件 `ClipList.vue` 进行代码逻辑审查与优化，消除已发现的 10 个代码缺陷，覆盖同步逻辑脆弱性、状态管理泄漏、竞态条件、错误处理缺失等问题。

## 核心修复项

### P0 - 必须修复

1. **手动输入同步循环守卫脆弱**：将 `syncingFromTrim` 模块级可变变量 + `syncManualToTrim`/`syncTrimFromInputs` + watcher 的循环防回写模式，重构为 computed getter/setter 架构，从结构上消除循环守卫。
2. **duration watch 中的魔数 30**：将 `trimEndSec.value === 30` 硬编码判断替换为专用的 `isInitialTrimEnd` 标志。

### P1 - 应该修复

3. **merge 成功后 clips 数组残留**：合并成功后从 clips 数组中同步移除已处理条目，避免引用已删除的临时文件。
4. **addFiles 竞态条件**：用递增请求 ID 模式序列化 `loadVideoMeta` 调用，丢弃过期响应。
5. **loadFirstFileOnly 静默丢弃文件**：仅在 files.length > 1 时执行，避免无意义操作。

### P2/P3 - 建议修复

6. **removeClip 中 deleteFile fire-and-forget**：改为 await + try/catch。
7. **canStart 语义不准**：为 split 模式单独添加 `canStartMerge` 命名。
8. **endedGuard 冗余**：移除 endedGuard，简化 onVideoEnded/onVideoPause。
9. **hmsToSeconds 无 NaN 防护**：在 syncTrimFromInputs 入口校验。
10. **onUnmounted 可选链清理不明确**：改为显式 if 判断。

## 技术栈

- **前端框架**：Vue 3.4 + TypeScript 5 + Composition API（`<script setup lang="ts">`）
- **状态管理**：Pinia（progress store）
- **IPC 通信**：Electron contextBridge（`window.electronAPI`）
- **工具函数**：`secondsToHMS` / `hmsToSeconds`（@/utils/time）、`clamp`（@/utils/math）

## 实现方案

### P0-1：手动输入同步重构（核心改动）

**现状问题**：模块级可变变量 `syncingFromTrim`（非响应式）协调两条数据路径：

- `trimStartSec/trimEndSec` → `syncManualToTrim()` 写回 `startHour/Min/Sec` → 触发 watcher → `syncTrimFromInputs()` 读回秒数
- 用户编辑输入 → watcher 触发 → `syncTrimFromInputs()` 更新秒数 → `trimEndSec` 变化 → `syncManualToTrim()` 写回输入

**新方案**：将 `startHour/Min/Sec` 和 `endHour/Min/Sec` 从 `ref` 改为 `computed`（get/set 模式）：

- **getter**：从 `trimStartSec` / `trimEndSec` 派生，使用 `secondsToHMS` 拆分为时/分/秒
- **setter**（用户编辑输入时触发）：将时/分/秒组合为秒数，直接写入 `trimStartSec` / `trimEndSec`（带 clamp + seek 逻辑）

**收益**：删除 `syncingFromTrim`、`syncManualToTrim`、`syncTrimFromInputs`、2 个 watcher（共约 30 行），数据流变为单向派生，无循环风险。模板中的 `v-model` 改为 `:value` + `@input` 或使用 `v-model`（Vue 3.4+ 支持 computed v-model）。

### P0-2：魔数 30 消除

**现状问题**：`watch(duration, ...)` 中 `trimEndSec.value === 30` 的 30 硬编码依赖初始值 `ref(30)`。

**新方案**：添加 `const isInitialTrimEnd = ref(true)`，在用户通过任何方式（拖拽手柄、手动输入、步进）修改 `trimEndSec` 时置为 `false`。duration watch 中改为 `if (trimEndSec.value > newDur || isInitialTrimEnd.value)`。

### P1-3：merge 后 clips 清理

**现状问题**：`startProcess()` 成功后删除临时文件，但 `clips` 数组保留已删除文件的引用。

**新方案**：在 `store.finish()` 之前，用 `Array.filter` 从 `clips.value` 中移除 `selected === true` 的条目。

### P1-4：addFiles 竞态修复

**新增**：模块级 `let loadRequestId = 0`，在 `addFiles` 中 `loadVideoMeta` 前 `++loadRequestId` 并捕获当前值传入 `loadVideoMeta`，在 `loadVideoMeta` 的 guard 中增加请求 ID 比对，丢弃过期响应。

### P1-5：loadFirstFileOnly 改进

**现状**：`loadFirstFileOnly()` 在 `watch(mode)` 切换时无条件调用。

**改进**：由于切换到 split 时 `files` 本来就只保留一个（merge 模式切换时 `files = []`），且 `files.value.length > 1` 是唯一的丢弃场景。可改为在 `watch(mode, ..., 'split')` 中，先检查 `files.value.length > 1` 再截断，避免无意义操作和不必要的 watch 触发。

### P2/P3 项

- **P2-6**：`removeClip` 改为 `async`，await `deleteFile` 并用 try/catch 包裹
- **P2-7**：`canStart` computed 改为仅在 merge 模式下有意义的 `canMerge`，split 模式单独处理
- **P3-8**：移除 `endedGuard`，`onVideoEnded` 简化为 `isPlaying.value = false`
- **P3-9**：在 `syncTrimFromInputs` 入口用 `isNaN(s) || isNaN(e)` 提前返回
- **P3-10**：`onUnmounted` 中 `window.electronAPI?.removeProgressListener()` 改为 `if (window.electronAPI) { window.electronAPI.removeProgressListener() }`

## 实施注意事项

### 性能

- P0-1 的 computed getter 每次访问会调用 `secondsToHMS` + `split`，由于仅用于模板绑定（6 个 input），渲染频率下开销可忽略
- P0-1 的 computed setter 中需在写入 `trimStartSec`/`trimEndSec` 后 seek 播放器，复用现有 `seekVideoPlayer` 函数

### 日志与错误处理

- P2-6 中 `deleteFile` 失败不阻塞 UI，仅 `console.warn` 记录即可
- P3-9 中 NaN 发生时重置输入为当前 trim 值（调用 computed 重新计算 getter）

### 向后兼容

- P0-1 改变为 computed 后，模板中 `v-model` 的绑定语义不变（Vue 3.4+ 原生支持 computed v-model），无需修改 ClipList.vue
- 其他修复均为内部重构，不影响父组件或路由

### 爆炸半径控制

- 所有修改仅限 `SplitMergeView.vue`（约 583 行 script），不改动 ClipList.vue 的 props/emit 接口
- 不改动 `time.ts`（在组件入口校验 NaN，保持工具函数纯净）