---
name: compress-view-fixes
overview: 修复 CompressView 的 5 个问题：audioBitrate 不生效（类型链路缺失）、onProgress 监听器泄露、selectedOutputDir 冗余状态、getOutputDir/sourceDir 重复逻辑、getAvailableEncoders 竞态风险。
todos:
  - id: fix-audiobitrate-types
    content: "补齐 audioBitrate 类型链：在 ffmpeg.ts、main/index.ts、preload/index.ts、preload/index.d.ts 的 BatchCompressOptions.files 子类型中增加 audioBitrate?: string"
    status: completed
  - id: fix-compress-view
    content: 修复 CompressView.vue 的 4 个运行时问题：onProgress finally 清理、selectedOutputDir ref→computed、getOutputDir/sourceDir 改用 getDirName、getAvailableEncoders unmounted 守卫
    status: completed
    dependencies:
      - fix-audiobitrate-types
  - id: add-getdirname-util
    content: 在 format.ts 中新增 getDirName 工具函数，提取路径目录部分
    status: completed
---

## 修复目标

修复 CompressView.vue 审查中发现的全部 5 个代码问题。

## 问题清单

### 1. audioBitrate 参数类型链缺失（功能性 Bug）

前端 CompressView 已发送 `audioBitrate` 参数，但批处理接口链的 4 处类型定义缺少该字段，导致用户无论选择什么音频码率都固定为默认 32k。需在 `ffmpeg.ts`、`main/index.ts`、`preload/index.ts`、`preload/index.d.ts` 的 `BatchCompressOptions.files` 子类型中各添加 `audioBitrate?: string`。

### 2. onProgress 监听器泄露

`startCompress()` 中注册的进度监听器在操作完成或异常后均未清理，仅依赖 `onUnmounted` 移除。用户不离开页面时监听器持续存活。需在 try-catch 后补充 finally 块调用 `removeProgressListener()`。

### 3. selectedOutputDir 冗余状态

`selectedOutputDir` ref + watcher 构成不必要的中间状态，其值完全可从 `files[0]?.outputPath` 派生。需删除 ref 和 watch，改为 computed。

### 4. getOutputDir 与 sourceDir 逻辑重复

两个函数均执行相同的"提取路径目录部分"操作。需提取为 `format.ts` 中的共享工具函数 `getDirName`，两处复用。

### 5. getAvailableEncoders 竞态风险

`onMounted` 中 await 赋值 `availableEncoders`，组件卸载后 Promise 仍会更新已卸载组件的 ref。需增加 unmounted 标志位守卫。

## 技术方案

### 修改策略

- **类型链补齐**：在 4 个文件的 `BatchCompressOptions.files` 子类型中各加 `audioBitrate?: string`，与已存在的 `CompressOptions.audioBitrate` 对齐。主进程 `batchCompress` 函数内部通过 `...file` 展开传递，值自动流通无需额外逻辑。
- **监听器生命周期**：在 `startCompress()` 的 try-catch 后添加 finally 块，无差别调用 `removeProgressListener()`，确保操作结束后无论成败都清理监听器。
- **状态精简**：删除 `selectedOutputDir` ref 和对应 watcher，新增 computed 直接从 `files[0]?.outputPath` 派生显示值。删除 `selectQuickDir` 中的手动赋值行（已被 `setOutputDir` 覆盖）。
- **工具提取**：在 `format.ts` 中新增 `getDirName(path: string): string`，实现 `path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')`，CompressView 的 `sourceDir` computed 和新的 `selectedOutputDir` computed 均调用它。
- **竞态防护**：新增 `let isUnmounted = false`，`onUnmounted` 设为 true，`getAvailableEncoders` 赋值前检查 `!isUnmounted`。

### 架构影响

- 所有修改均为局部改动，不影响其他视图
- `getDirName` 新增为共享工具，符合 CODEBUDDY.md "utils 目录：共享工具函数" 规范
- 类型补齐仅增加可选字段，向后兼容

### 文件修改清单

```
src/renderer/src/utils/format.ts           # [MODIFY] 新增 getDirName(path) 函数
src/renderer/src/views/Compress/CompressView.vue  # [MODIFY] 修复 4 处运行时问题
src/main/modules/ffmpeg.ts                 # [MODIFY] BatchCompressOptions.files +audioBitrate
src/main/index.ts                          # [MODIFY] wrapOperation 泛型 files +audioBitrate
src/preload/index.ts                       # [MODIFY] batchCompress.files +audioBitrate
src/preload/index.d.ts                     # [MODIFY] ElectronAPI.batchCompress.files +audioBitrate
```