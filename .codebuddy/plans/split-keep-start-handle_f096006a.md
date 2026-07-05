---
name: split-keep-start-handle
overview: 裁剪成功后保留前手柄（trimStartSec）当前位置不动，仅将后手柄（trimEndSec）重置到视频末尾，并 seek 到前手柄位置便于继续裁剪。
todos:
  - id: fix-trim-reset
    content: 修改 cutToClipList 成功分支：前手柄保持不动、后手柄重置到 duration、seek 到前手柄位置
    status: completed
---

## 用户需求

裁剪（裁切到列表）成功后，前手柄（trimStartSec）保持当前位置不动，仅将后手柄（trimEndSec）重置到视频末尾，视频定位到前手柄位置以便继续向后选取下一段。

## 当前行为

`cutToClipList()` 成功分支（`SplitMergeView.vue:455-458`）将前后手柄都重置：前手柄归零、后手柄归末尾、视频 seek 到 0。

## 期望行为

- 前手柄（start）：保持裁剪时的位置不动
- 后手柄（end）：重置到视频末尾 duration
- 视频：定位到前手柄位置

## 技术方案

仅修改 `SplitMergeView.vue` 的 `cutToClipList()` 成功分支 3 行代码，无新增依赖，不改变 IPC 接口与功能流程。

### 修改内容

将 `:455-458`：

```ts
// Reset trim handles to default (full video range)
trimStartSec.value = 0
trimEndSec.value = duration.value
seekVideoPlayer(0)
```

改为：

```ts
// 前手柄保持当前位置不动，仅重置后手柄到视频末尾，便于继续裁剪后续片段
trimEndSec.value = duration.value
seekVideoPlayer(trimStartSec.value)
```

### 变更点

1. 删除 `trimStartSec.value = 0` —— 前手柄保持不动
2. 保留 `trimEndSec.value = duration.value` —— 后手柄重置到末尾
3. `seekVideoPlayer(0)` 改为 `seekVideoPlayer(trimStartSec.value)` —— 视频定位到前手柄位置

## 边界验证

- 裁剪前提 `clipDurationSec > 0`（:421-424 校验），即 `trimStartSec < trimEndSec <= duration`，故 `trimStartSec < duration` 恒成立
- 重置 end 到 duration 后，`trimStartSec < duration` 满足 end 手柄约束 `trimEndSec >= trimStartSec + 0.1`，无边界冲突
- 若用户首次裁剪从 0 开始（trimStartSec=0），seek(0) 与原行为一致，无回归
- `seekVideoPlayer` 内部已做 null 守卫，无空指针风险

## 实现注意事项

- `cutToClipList` 开头已有 `videoPlayer.value?.pause()`（上一轮修复），裁剪后 video 处于暂停状态，seek 仅定位不触发播放，符合预期
- 此修改不涉及 `isInitialTrimEnd`（已移除）及其他手柄约束逻辑，watch(duration) 的 clamp 逻辑不受影响