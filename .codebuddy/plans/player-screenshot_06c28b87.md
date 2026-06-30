---
name: player-screenshot
overview: 为 Player 播放器添加 FFmpeg 视频截图功能：单帧捕获（当前帧 或 指定时间）、批量截图（定时间隔），输出到视频同目录
todos:
  - id: add-ffmpeg-screenshot
    content: 在 ffmpeg.ts 新增 captureScreenshot 函数（spawn ffmpeg 单帧截图，支持取消和进度回调）
    status: completed
  - id: register-ipc-handler
    content: 在 main/index.ts 注册 video:screenshot IPC handler（wrapOperation，lockType='screenshot'）
    status: completed
    dependencies:
      - add-ffmpeg-screenshot
  - id: expose-preload-api
    content: 在 preload/index.ts 和 index.d.ts 新增 captureScreenshot API 类型声明
    status: completed
  - id: add-screenshot-ui
    content: 在 PlayerView.vue 新增截图模态弹窗：Header 增加 Camera 按钮、三种截图模式表单、进度条、输出路径生成逻辑
    status: completed
    dependencies:
      - register-ipc-handler
      - expose-preload-api
---

## 产品概述

为 Player 播放器模块新增视频截图功能，通过 FFmpeg 命令提取视频原始分辨率的帧图像，保存为 PNG 格式到视频文件同目录。

## 核心功能

- **当前帧一键截图**：点击"当前画面"按钮，立即捕获播放器当前时间点的一帧，保存为 `{视频名}_screenshot_{HH-MM-SS}.png`
- **指定时间截图**：输入精确时间（秒或 HH:MM:SS），点击截图，保存为同格式文件
- **批量截图**：设置间隔秒数（默认 10 秒），自动计算全视频范围内的时间点并逐帧截图，文件名 `{视频名}_frame_{NNN}.png`，进度显示当前帧/总帧数
- **加密视频兼容**：若加密视频已解密播放（有 tempPath），自动使用解密临时文件路径截图；若未解密，提示用户先解密再截图
- **截图弹窗**：Header 新增"截图"按钮（Camera 图标），点击弹出模态面板，内含三种截图模式的表单和操作按钮

## 技术栈

- 主进程：Node.js + FFmpeg（`child_process.spawn`）
- IPC：Electron `ipcMain.handle` / `ipcRenderer.invoke`
- 渲染进程：Vue 3 Composition API + lucide-vue-next 图标
- 持久化：无（截图状态为瞬态 UI）

## 实现方案

### 架构概览

```
用户点击截图按钮 → 弹窗模态面板
  ├─ 当前帧：读取 player.currentTime → 调 IPC → ffmpeg 单帧截图
  ├─ 指定时间：用户输入时间 → 调 IPC → ffmpeg 单帧截图
  └─ 批量：循环调用 IPC（每帧一次） → progress 回调更新进度条
```

### FFmpeg 命令设计

```
# 单帧截图（关键帧定位 + 精确 seek）
ffmpeg -ss {time} -i {input} -vframes 1 -q:v 2 {output}.png
```

- `-ss {time}` 放在 `-i` 前：使用关键帧快速定位
- `-q:v 2`：高质量 PNG 输出（1-31，值越小质量越高）

### IPC 通道设计

```
channel: 'video:screenshot'
handler: wrapOperation(lockType='screenshot', progressType='screenshot')
输入: { input: string; output: string; time: number }
```

批量截图在渲染进程侧循环调用该 IPC，每帧独立 spawn，支持：

- 取消：`operation:cancel` → `cancelFfmpegOperation()` 终止当前 ffmpeg 进程
- 进度：通过 `onProgress` 推送 `{ currentFile, totalFiles, percent }`

### 加密视频处理

截图前检测 `currentFile.value.isEncrypted`：

- 若有 `tempPath`（已解密）→ 使用 `tempPath` 作为 ffmpeg 输入
- 若无 `tempPath` → 设置 `errorMsg` 提示"请先播放加密视频完成解密后再截图"

### 输出路径生成

```typescript
// 单帧
const base = currentFileName.replace(/\.[^.]+$/, '')
const ts = new Date().toTimeString().slice(0, 8).replace(/:/g, '-')
output = `${videoDir}/${base}_screenshot_${ts}.png`

// 批量
output = `${videoDir}/${base}_frame_${String(i+1).padStart(3, '0')}.png`
```

## 实现细节

### 文件变更清单

#### 1. `src/main/modules/ffmpeg.ts` [MODIFY]

新增函数：

- `captureScreenshot(opts: { input: string; output: string; time: number; onProgress?: ProgressCallback }): Promise<boolean>`
- spawns ffmpeg with `-ss <time> -i <input> -vframes 1 -q:v 2 <output>` 
- 参考 `splitVideo` 模式：Promise 包装 + stderr 监听 + 取消支持

#### 2. `src/main/index.ts` [MODIFY]

- 在 `registerPlayerHandlers()` 内部新增 wrapOperation 注册：

```
wrapOperation<{ input: string; output: string; time: number }>(
'video:screenshot', 'screenshot', 'screenshot',
(opts, onProgress) => captureScreenshot({ ...opts, onProgress })
)
```

- 在 `import` 中从 ffmpeg 模块新增 `captureScreenshot` 导入

#### 3. `src/preload/index.ts` [MODIFY]

在 `electronAPI` 对象中新增方法：

```typescript
captureScreenshot: (opts: { input: string; output: string; time: number }): Promise<boolean> =>
  ipcRenderer.invoke('video:screenshot', opts),
```

#### 4. `src/preload/index.d.ts` [MODIFY]

在 `ElectronAPI` 接口中新增类型声明：

```typescript
captureScreenshot: (opts: { input: string; output: string; time: number }) => Promise<boolean>
```

#### 5. `src/renderer/src/views/Player/PlayerView.vue` [MODIFY]

- **Script 扩展**：
- 新增 icon 导入：`Camera`
- 新增截图弹窗状态：`showScreenshotModal`, `screenshotTimeInput`, `batchInterval`, `capturing`, `captureProgress`
- 新增函数：
    - `openScreenshotModal()`：打开弹窗
    - `captureCurrentFrame()`：读取 `player.currentTime`，生成输出路径，调用 IPC
    - `captureByTime()`：使用用户输入的时间调用 IPC
    - `batchCapture()`：计算所有时间点，循环调用 `captureScreenshot()`，更新进度
    - `getScreenshotInputPath()`：返回加密视频的 tempPath 或普通视频的 path
    - `generateScreenshotOutput(timeSec)`：生成单帧输出路径
    - `generateBatchOutput(index)`：生成批量帧输出路径
- **Template 扩展**：
- Header 按钮区新增"截图"按钮（Camera 图标），仅 `currentFile` 非空时显示
- 新增 `Teleport to="body"` 截图模态弹窗：
    - "当前画面"区块：显示当前时间，一键截图按钮
    - "指定时间"区块：秒数输入框 + 截图按钮
    - "批量截图"区块：间隔输入（默认 10） + 帧数预览 + 开始按钮
    - 进度条（批量截图时显示：帧 N/M）