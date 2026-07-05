---
name: split-reset-start-to-clip-end
overview: 裁剪完成后将前手柄重置到刚裁剪片段的结束位置（如 10s→20s 裁剪后前手柄=20s），后手柄仍重置到 duration，便于用户连续裁剪后续片段。
todos:
  - id: update-trim-reset
    content: 修改 cutToClipList 成功分支：前手柄重置到裁剪结束位置，后手柄重置到 duration，加边界 clamp
    status: completed
---

## 用户需求

裁剪完成后，前手柄（trimStartSec）重置到本次裁剪的结束位置，后手柄仍重置到视频末尾。例如：裁剪片段 10s→20s，完成后前手柄自动跳到 20s，方便直接从此位置继续向后选取下一片段。

## 核心改动

`SplitMergeView.vue:537-539`，将裁剪成功后的 trimStartSec 从"保持不动"改为"设为裁剪结束位置"，加边界 clamp 防御。

## 修改内容

仅修改 `SplitMergeView.vue` 一处，将 `:537-539`：

```ts
// 前手柄保持当前位置不动，仅重置后手柄到视频末尾，便于继续裁剪后续片段
trimEndSec.value = duration.value
seekVideoPlayer(trimStartSec.value)
```

改为：

```ts
// 前手柄重置到本次裁剪结束位置，后手柄重置到视频末尾，便于连续裁剪后续片段
const clipEnd = trimEndSec.value
trimStartSec.value = Math.min(clipEnd, Math.max(0, duration.value - 0.1))
trimEndSec.value = duration.value
seekVideoPlayer(trimStartSec.value)
```

## 变更点

1. 裁剪结束位置 `trimEndSec.value` 先保存到 `clipEnd`（在第二行被 duration 覆盖前）
2. `trimStartSec` 设为 `clipEnd`，加双重 clamp 防御：

- `Math.max(0, duration.value - 0.1)` 防止 duration < 0.1 时 clamp 到负数
- `Math.min(clipEnd, ...)` 防止裁剪到视频末尾时 start == end 违反约束

3. 后手柄仍重置到 `duration`
4. seek 到新前手柄位置

## 边界

- 裁剪前提 `clipDurationSec > 0`，`trimStartSec < trimEndSec <= duration`，故 `clipEnd <= duration` 恒成立
- `clipEnd == duration`：start = duration-0.1，end = duration，满足 start < end 约束
- 极短视频（duration < 0.1）不会触发裁剪（`clipDurationSec > 0` 通不过）

## 影响范围

仅 `SplitMergeView.vue` 一个文件，3 行修改，不改变 IPC 接口与功能流程。