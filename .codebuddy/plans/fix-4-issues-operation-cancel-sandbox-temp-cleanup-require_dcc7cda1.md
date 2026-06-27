---
name: fix-4-issues-operation-cancel-sandbox-temp-cleanup-require
overview: 修复 4 个代码质量问题：1) FFmpeg 进程真正可取消；2) 开启 Electron sandbox；3) 应用退出时清理临时文件；4) 主进程移除 require() 改用 import
todos:
  - id: ffmpeg-cancel
    content: 在 ffmpeg.ts 中添加模块级 currentProc/isCancelled 变量，导出 cancelFfmpegOperation()，修改 splitVideo/mergeVideos/compressVideo 在取消时 resolve(false)
    status: completed
  - id: crypto-cancel
    content: 在 crypto.ts 中添加模块级 activeStreams/isCancelled 变量，导出 cancelCryptoOperation()，修改 encryptFile/decryptFile 在取消时 resolve(false)
    status: completed
  - id: index-wire-cancel
    content: 修改 index.ts：导入 cancel 函数，重写 registerCancelHandler() 调用两个取消函数，删除未使用的 activeProcess 变量
    status: completed
    dependencies:
      - ffmpeg-cancel
      - crypto-cancel
  - id: sandbox-temp-import
    content: "修改 index.ts：sandbox: false 改为 sandbox: true、window-all-closed 中清理 sn-video-clips 目录、移除两处 require('fs') 改为顶部 import"
    status: completed
---

## 需求概述

修复 SN Video Editor 项目中 4 个代码质量与安全性问题，均为底层改进，不影响现有 UI 和功能逻辑。

## 改动项

### 1. 操作真正支持取消

当前 `operation:cancel` handler 仅记录标志位，未实际终止 ffmpeg 进程或 crypto 流。需要做到：

- 点击取消按钮后，ffmpeg 进程被 `SIGTERM` 信号终止
- crypto 加密/解密的读写流被销毁
- 取消时 Promise 以 `false` resolved（而非 reject），避免渲染进程弹出错误提示
- 多个并发函数（splitVideo / mergeVideos / compressVideo / encryptFile / decryptFile）均需支持

### 2. 启用 Electron Sandbox

当前 `createWindow()` 中 `sandbox: false` 关闭了 Chromium 沙箱保护。由于 preload 脚本仅使用 `contextBridge` + `ipcRenderer`（无毒 require、无毒 Node API），完全兼容 `sandbox: true`。需保留 `webSecurity: false`（renderer 用 `file:///` 播放本地视频）。

### 3. 临时文件清理

分割操作产生的临时片断存放在 `app.getPath('temp')/sn-video-clips/` 目录。当前无退出清理机制，多次使用后残留文件会越积越多。需在应用退出时删除整个目录。

### 4. 移除 require() 混用

`src/main/index.ts` 中 `getTempClipsDir()` 和 `file:delete` handler 内联使用了 `const fs = require('fs')`，而非标准 ES module `import`。应统一改为顶部 `import * as fs from 'fs'`（与 `file.ts` 模块一致）。

## 技术方案

### 1. FFmpeg 进程取消机制

**策略**：在 `ffmpeg.ts` 模块级维护当前活跃进程引用 + 取消标志位，导出 `cancelFfmpegOperation()` 函数。

**修改文件**：`src/main/modules/ffmpeg.ts`

- 新增模块级变量：

```typescript
let currentProc: ChildProcess | null = null
let isCancelled = false
```

- 新增导出函数：

```typescript
export function cancelFfmpegOperation(): void {
isCancelled = true
if (currentProc) {
currentProc.kill('SIGTERM')
currentProc = null
}
}
```

- 修改 `splitVideo` / `mergeVideos` / `compressVideo`：
- 函数开头重置 `isCancelled = false`
- `spawn()` 后赋值 `currentProc = proc`
- `proc.on('close')` 中先置 `currentProc = null`，再检查 `isCancelled`：若为 true 则 `resolve(false)`
- `proc.on('error')` 中置 `currentProc = null`
- 已有 `import { spawn, spawnSync } from 'child_process'`，需改为 `import { spawn, spawnSync, type ChildProcess } from 'child_process'` 以使用类型

### 2. Crypto 流取消机制

**策略**：在 `crypto.ts` 模块级追踪活跃流引用 + 取消标志，导出 `cancelCryptoOperation()`。

**修改文件**：`src/main/modules/crypto.ts`

- 新增模块级变量：

```typescript
let isCancelled = false
let activeStreams: { input: fs.ReadStream; output: fs.WriteStream } | null = null
```

- 新增导出函数：

```typescript
export function cancelCryptoOperation(): void {
isCancelled = true
if (activeStreams) {
activeStreams.input.destroy()
activeStreams.output.destroy()
activeStreams = null
}
}
```

- 修改 `encryptFile` / `decryptFile`：
- 创建读写流后赋值 `activeStreams = { inputStream, outputStream }`
- `outputStream.on('finish')` 中置 `activeStreams = null`
- 流 error handler 中检查 `isCancelled`：若 true 则 `resolve(false)` 而非 reject
- 函数结尾的 error handler 同样处理取消场景

### 3. 主进程 index.ts 统一调度取消

**修改文件**：`src/main/index.ts`

- 修改 import 语句，新增导入：

```typescript
import { splitVideo, mergeVideos, compressVideo, batchCompress, getVideoMeta, cancelFfmpegOperation } from './modules/ffmpeg'
import { encryptFile, decryptFile, batchProcessFiles, cancelCryptoOperation } from './modules/crypto'
```

- 删除不再需要的 `let activeProcess` 变量（L20）
- 重写 `registerCancelHandler()`：

```typescript
function registerCancelHandler(): void {
ipcMain.handle('operation:cancel', async () => {
cancelFfmpegOperation()
cancelCryptoOperation()
return true
})
}
```

### 4. 启用 sandbox + 保留 webSecurity: false

**修改文件**：`src/main/index.ts`

- 将 `createWindow()` 中 `sandbox: false` 改为 `sandbox: true`
- `webSecurity: false` 保持不变（renderer 需 `file:///` 播放本地视频）
- `contextIsolation: true` 保持不变

### 5. 退出时清理临时目录

**修改文件**：`src/main/index.ts`

- 在 `app.on('window-all-closed')` 中添加清理逻辑：

```typescript
app.on('window-all-closed', () => {
const tempClipsDir = join(app.getPath('temp'), 'sn-video-clips')
try {
if (fs.existsSync(tempClipsDir)) {
fs.rmSync(tempClipsDir, { recursive: true, force: true })
}
} catch { /* 静默忽略清理失败 */ }
if (process.platform !== 'darwin') {
app.quit()
}
})
```

- 同时在 `app.on('before-quit')` 中也执行相同清理，确保所有退出路径覆盖

### 6. require('fs') → import

**修改文件**：`src/main/index.ts`

- 顶部新增：`import * as fs from 'fs'`
- `getTempClipsDir()` 中删除 `const fs = require('fs')`（L25），使用顶部导入
- `file:delete` handler 中删除 `const fs = require('fs')`（L244），使用顶部导入

## 影响范围

- 仅修改主进程文件（`index.ts`、`ffmpeg.ts`、`crypto.ts`）
- 不修改 preload、renderer、组件、样式
- 渲染进程已有 `progressStore.cancel()` 调用链，无需改动
- `sandbox: true` 对现有 preload 无影响（已兼容）

## 边界情况

- 取消时输出文件（不完整的 ffmpeg 产物 / 加密产物）会残留——由用户自行清理
- 取消后 progressStore.reset() 已正常重置 UI 状态