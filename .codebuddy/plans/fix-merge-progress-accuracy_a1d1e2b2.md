---
name: fix-merge-progress-accuracy
overview: 修复 mergeVideos 进度计算：合并前用 ffprobe 并行获取所有输入文件时长求和作为总时长，进度改为 已处理时间/总时长，替代当前错误的 秒/(文件数×100) 计算。
todos:
  - id: fix-merge-progress
    content: 在 ffmpeg.ts 中新增 probeDuration 函数并重构 mergeVideos 为 async，修复进度计算逻辑
    status: completed
---

## 产品概述

合并页面（SplitMerge 合并模式）的合并进度百分比计算存在严重 bug，导致进度显示不准确（长期卡在低百分比或提前到 100%）。需要修复 `mergeVideos` 主进程函数中的进度计算逻辑，使其基于所有输入文件的实际总时长来计算进度。

## 核心功能

- 修复 `mergeVideos` 进度计算：用 ffprobe 预先获取所有输入文件总时长，以 `已处理秒数 / 总时长` 计算进度百分比
- 保持原有的合并功能、取消机制、进度推送链路不变
- ffprobe 获取时长失败时优雅降级（进度保持 0%，完成时仍推 100%）

## 技术栈

- Electron 31 + Node.js child_process（spawn）
- FFmpeg / FFprobe（通过 `getFfprobePath()` 复用已有二进制解析）
- TypeScript 严格模式

## Bug 分析

`mergeVideos` 进度计算（`src/main/modules/ffmpeg.ts:182-184`）存在单位错配：

```ts
const totalFrames = opts.inputs.length * 100          // 文件数×100，无物理意义
const current = Math.min(Math.round(timeToSeconds(parsed.time)), totalFrames)  // 秒 vs 无意义数字
const percent = Math.min(Math.round((current / totalFrames) * 100), 100)
```

**后果举例**：

- 合并 3 个各 60 秒的文件：总时长 180 秒，但 `totalFrames=300`。完成时进度 = 180/300*100 = 60%，永远到不了 100%（只有 close 事件才强制推 100%）
- 单个文件时长 >100 秒：`current` 被 clamp 到 100（`inputs.length=1` 时 `totalFrames=100`），进度提前卡 100%

**正确参考**：同文件 `splitVideo`（99-101行）用 `current/total` 时间比计算，逻辑正确。

## 实现方案

在 `mergeVideos` 中 spawn ffmpeg 前，用 ffprobe 并行获取所有输入文件时长，求和得到 `totalDurationSec`，进度改为 `currentSec / totalDurationSec * 100`。

### 关键技术决策

1. **新增 `probeDuration` 辅助函数**（而非复用 `getVideoMeta`）：

- `getVideoMeta` 返回完整元数据且调用 `_setFfmpegProc`（会与主合并 proc 冲突）
- `probeDuration` 仅获取 duration 字段，独立 spawn，不占用 `currentProc` 槽位
- 使用 `-show_entries format=duration -of default=noprint_wrappers=1:nokey=1` 轻量查询

2. **`mergeVideos` 改为 async**：

- 原为 `function mergeVideos(opts): Promise<boolean> { return new Promise(...) }`
- 改为 `async function mergeVideos(opts): Promise<boolean>`，spawn 前 `await Promise.all`
- `wrapOperation`（index.ts:173-174）调用 `mergeVideos({...})` 返回 Promise，async 改造完全兼容

3. **容错降级**：

- `probeDuration` 失败时 `resolve(0)`，不阻塞合并流程
- `totalDurationSec === 0` 时 percent 保持 0（避免显示错误进度），close 时仍推 100%

## 实现注意事项

- ffprobe 并行调用毫秒级，对启动延迟影响可忽略
- `parseProgressLine` / `timeToSeconds` / `getFfprobePath` 均已从 ffmpeg-shared 导入，无需新增 import
- ffmpeg concat `-c copy` 的 `time=` 反映输出文件已写入位置，`time/总时长` 是合理的进度估算
- 保持 `currentFile: 1, totalFiles: 1`（concat 单次操作语义不变）
- 保持 `eta: parsed.time`（与 splitVideo 一致，不在本次范围）

## 目录结构

```
src/main/modules/
└── ffmpeg.ts  # [MODIFY] 修复 mergeVideos 进度计算
```

修改点明细（`e:\demo\snVideoEditor\src\main\modules\ffmpeg.ts`）：

1. **新增 `probeDuration` 函数**（插入在 `mergeVideos` 之前，约 140 行处）：

- 签名：`function probeDuration(filePath: string): Promise<number>`
- spawn ffprobe 获取单个文件时长（秒），失败 resolve(0)
- 不调用 `_setFfmpegProc`

2. **重构 `mergeVideos`**（143-229 行）：

- 改为 `async function mergeVideos(opts: MergeOptions): Promise<boolean>`
- `resetCancelled()` 之后、`spawn` 之前，添加：

```ts
let totalDurationSec = 0
try {
const durations = await Promise.all(opts.inputs.map(probeDuration))
totalDurationSec = durations.reduce((sum, d) => sum + d, 0)
} catch { /* ignore, fallback to 0 */ }
```

- stderr data 回调中进度计算改为：

```ts
const currentSec = timeToSeconds(parsed.time)
const percent = totalDurationSec > 0
? Math.min(Math.round((currentSec / totalDurationSec) * 100), 100)
: 0
```

- 其余逻辑（concat list 写入、spawn、close/error 处理、取消检查）保持不变