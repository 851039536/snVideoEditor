---
name: nvenc-bitrate-overshoot-fix
overview: 修复 NVENC 显式比特率模式下输出码率远超目标（320k→560k）的问题：在 buildCompressArgs 的 bitrate 分支为 NVENC 补充 -rc vbr -maxrate -bufsize 约束峰值。
todos:
  - id: fix-nvenc-bitrate
    content: 在 ffmpeg-compress.ts 中新增 doubleBitrate 工具函数，并在 buildCompressArgs 的 opts.bitrate 分支为 NVENC 追加 -rc vbr -maxrate -bufsize 速率约束
    status: completed
---

## 问题概述

用户设置目标视频比特率 320k，使用 hevc_nvenc 编码压缩后，输出视频码率约 560k，超出目标 75%。

## 根因

NVENC 在 VBR 模式下，仅传 `-b:v 320k` 而不设 `-maxrate` 约束时，编码器对复杂场景的码率峰值无上限，平均码率大幅超出目标值。

## 修复目标

- 显式设置比特率 + NVENC 编码时，输出码率应贴近目标值（误差 ≤ ~10%）
- CRF 模式（`-rc vbr -cq`）行为不变
- QSV / libx264 / libx265 分支不受影响
- 取消/回退链不受影响

## 影响范围

- 仅修改 `buildCompressArgs` 函数的 `opts.bitrate` 分支，新增 NVENC 速率约束参数
- 新增一个 `doubleBitrate` 工具函数用于计算 `-bufsize`

## 技术栈

- 修改文件：`src/main/modules/ffmpeg-compress.ts`（主进程 ffmpeg 参数构建）
- 技术栈不变，沿用现有 fluent-ffmpeg + NVENC 参数体系

## 实现方案

### 根因定位（已验证，`ffmpeg-compress.ts:111-112`）

```ts
if (opts.bitrate) {
  args.push('-b:v', opts.bitrate)   // ← NVENC 无 -rc/-maxrate/-bufsize，VBR 峰值放飞
}
```

### 修复策略

在 `opts.bitrate` 分支内，当编码器为 NVENC 时追加速率约束参数：

1. **`-rc vbr`** — 显式声明可变码率模式（NVENC 需显式指定才遵守 maxrate 约束）
2. **`-maxrate <bitrate>`** — 峰值上限 = 目标码率，强制复杂场景不超出
3. **`-bufsize <2x bitrate>`** — 速率缓冲区为目标的 2 倍，给编码器少量帧级灵活性，但长时平均贴近目标

### `doubleBitrate` 工具函数

解析形如 `'320k'`/`'1.5M'`/`'2000k'` 的码率字符串，数值翻倍后返回（`'640k'`/`'3M'`/`'4000k'`）。解析失败时原样返回，保证安全性。

### 修复后该分支预期形态

```ts
if (opts.bitrate) {
  args.push('-b:v', opts.bitrate)
  if (isNvenc) {
    args.push('-rc', 'vbr', '-maxrate', opts.bitrate, '-bufsize', doubleBitrate(opts.bitrate))
  }
} else if (isNvenc) {
  ...
```

## 实现注意事项

- **不影响 CRF 路径**：CRF 走 `else if (isNvenc)` 分支，完全独立
- **不影响 twoPass**：NVENC 的 twoPass 已被禁用（`useTwoPass = opts.twoPass && !!opts.bitrate && !isGpu`），GPU 编码器不进入两遍编码路径
- **不影响回退链**：仅修改参数构建，`compressVideo` 的 full-gpu → software → libx264 三级回退控制流不变
- **QSV/libx264 不受影响**：`isNvenc` 判断隔离了非 NVENC 编码器，它们仍只传 `-b:v`
- **性能无影响**：增加 3 个参数仅约束速率控制策略，不改变解码/编码管线，对速度无影响

## 验证点

- 设置比特率 320k + hevc_nvenc 压缩，输出视频码率应 ≤ ~350k（含 32k 音频后总码率 ~382k）
- 不设比特率 + hevc_nvenc（CRF 模式）行为不变
- 设置比特率 + libx264 行为不变（仅传 `-b:v`）