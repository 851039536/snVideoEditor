---
name: fix-nvenc-cross-machine
overview: 修复 3 个 NVIDIA 编码器跨机器失败问题：编码器选择不校验导致模型值不匹配、失败原因被丢弃、getAvailableEncoders 静默失败无提示。
todos:
  - id: fix-batch-failed-type
    content: "修改 ffmpeg-compress.ts：batchCompress 的 failed 从 string[] 改为 { input: string; error: string }[]，catch 块存储错误消息"
    status: completed
  - id: sync-preload-types
    content: 同步 preload/index.ts 和 preload/index.d.ts 中 batchCompress 返回类型
    status: completed
    dependencies:
      - fix-batch-failed-type
  - id: fix-compress-view
    content: 修改 CompressView.vue：onMounted 增加编码器校验重置、catch 块增加诊断日志、失败展示升级为显示错误原因
    status: completed
    dependencies:
      - fix-batch-failed-type
      - sync-preload-types
---

## 需求

修复上一轮审查发现的 3 个导致 NVIDIA 压缩在部分电脑上失败的根因。

## 核心修复点

### 1. 跨机器编码器选择无校验

当用户在支持 NVENC 的电脑上选择了 `h264_nvenc` 编码器后，该设置通过 localStorage 持久化。切换到不支持 NVENC 的电脑时，`codec` ref 依然为 `h264_nvenc`，但下拉框不渲染对应 option（`v-if="hasNvidiaEncoders"` 为 false），造成"看起来是 H.264 软件编码、实际模型仍是 NVENC"的视觉假象。ffmpeg 收到 `h264_nvenc` 后报 Unknown encoder 错误。

**修复**：`onMounted` 获取编码器列表后，若当前 `codec` 值不在 `availableEncoders` 中，自动重置为 `libx264`。

### 2. batchCompress 失败原因被丢弃

`batchCompress` 在文件压缩失败时 catch 异常，但只存储了 `file.input` 路径，`e.message`（ffmpeg 具体错误信息）被完全丢弃。渲染端 `startCompress` 只展示失败文件名列表，用户无法得知失败原因（如 "Unknown encoder 'h264_nvenc'"）。

**修复**：`failed` 从 `string[]` 改为 `{ input: string; error: string }[]`，同步主进程、preload 类型定义和渲染端展示。

### 3. getAvailableEncoders 静默失败

ffmpeg 启动失败时（如安全软件拦截、二进制损坏），`getAvailableEncoders` 静默 `resolve([])`，CompressView 的 `onMounted` catch 块也为空。编码器列表为空、GPU 选项不显示，但用户完全不知道原因。

**修复**：CompressView `onMounted` 中，当 `availableEncoders` 为空时输出诊断日志；保持主进程容错行为不变（继续 resolve([]) 防止阻塞启动）。

## 技术栈

- Vue 3.4 + Composition API + TypeScript 5
- Electron IPC（contextBridge + ipcMain.handle）
- Node.js child_process（ffmpeg 编码器检测）

## 实现方案

### 改动范围（4 个文件，零新增文件）

| 文件 | 改动 | 行数 |
| --- | --- | --- |
| `src/main/modules/ffmpeg-compress.ts` | `failed` 类型 `string[]` → `{ input: string; error: string }[]` | ~5 行 |
| `src/preload/index.ts` | 同步 `batchCompress` 返回类型 | ~2 行 |
| `src/preload/index.d.ts` | 同上 | ~2 行 |
| `src/renderer/src/views/Compress/CompressView.vue` | onMounted 编码器校验 + 失败展示升级 | ~15 行 |


### 具体改动细节

#### 1. `ffmpeg-compress.ts` — 返回类型和 catch 块

返回类型：

```ts
Promise<{ success: number; successFiles: string[]; failed: { input: string; error: string }[] }>
```

catch 块改为：

```ts
const msg = e instanceof Error ? e.message : String(e)
failed.push({ input: file.input, error: msg })
```

#### 2. `preload/index.ts` + `index.d.ts` — 类型同步

`batchCompress` 返回 Promise 类型中 `failed: string[]` → `failed: { input: string; error: string }[]`

#### 3. `CompressView.vue` — onMounted 编码器校验

在 `availableEncoders.value = encoders` 之后增加：

```ts
// 若当前 codec 不在可用列表中，重置为安全默认值
if (encoders.length > 0 && !encoders.includes(codec.value)) {
  codec.value = 'libx264'
}
```

同时 catch 块增加诊断日志（`console.warn`），帮助排查 ffmpeg 启动失败场景。

#### 4. `CompressView.vue` — 失败展示升级

原代码：

```ts
const failedNames = result.failed.map((_p) => {
  const f = files.value.find((x) => x.path === _p)
  return f ? getFileName(f.path) : _p
}).join(', ')
errorMsg.value = `${result.failed.length} 个文件压缩失败: ${failedNames}`
```

改为遍历 `{ input, error }` 对象，展示文件名和对应错误原因。

## 设计决策

- **保持主进程 `getAvailableEncoders` 容错不变**：因为该函数在 app 启动早期调用，如果 reject 会阻塞启动流程；而 `resolve([])` + 前端诊断日志足以帮助排查问题。
- **`failed` 类型改为结构化对象而非 `Map`**：保持与 IPC 序列化兼容，`{ input, error }` 对象可以被 Electron IPC 安全传递。
- **编码器校验放在渲染端**：避免主进程跨模块依赖 settings store，保持主进程无状态。