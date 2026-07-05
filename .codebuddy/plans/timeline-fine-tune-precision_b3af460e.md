---
name: timeline-fine-tune-precision
overview: 将时间轴精细模式（Shift+拖拽）从相对倍率 nativeRes/FINE_DRAG_SCALE 改为绝对值 0.1s/px，使精细度与视频时长无关，移动 10px 仅 1 秒。
todos:
  - id: replace-fine-constant
    content: 将 FINE_DRAG_SCALE 替换为 FINE_SECONDS_PER_PX=0.1，更新 scrub 和手柄两处精细模式计算
    status: completed
---

## 用户需求

Shift+拖拽精细模式下，移动一次约前进 8-10 秒，精细度不够，需要更细腻。

## 问题根因

当前精细模式用相对倍率 `nativeRes / FINE_DRAG_SCALE`（即 `(duration / 时间轴宽度) / 5`），长视频时 nativeRes 大，即使除以 5 仍粗糙。精细度应与视频时长无关，改为绝对秒/像素。

## 技术方案

将相对倍率 `FINE_DRAG_SCALE = 5` 替换为绝对值 `FINE_SECONDS_PER_PX = 0.1`（每像素 0.1 秒），移动 10px = 1 秒，比当前精细 8 倍，且与视频时长无关。

### 修改点（均在 `SplitMergeView.vue`，共 3 处）

1. **第 38-39 行**：`const FINE_DRAG_SCALE = 5` → `const FINE_SECONDS_PER_PX = 0.1`
2. **第 455-461 行**（scrub 精细模式）：删除 `el`/`rect`/`nativeRes`，`delta = (clientX - lastX) * FINE_SECONDS_PER_PX`
3. **第 482-484 行**（裁剪手柄精细模式）：`nativeRes / FINE_DRAG_SCALE` → `FINE_SECONDS_PER_PX`（注意 `nativeRes` 仍被下方 `else if` 分支使用，不可删除）

### 实现注意事项

- scrub 精细分支仍需 `duration.value <= 0` 守卫
- 裁剪手柄区 `nativeRes`（第 477 行）被 `else if (nativeRes > MAX_SECONDS_PER_PX)` 依赖，保留不动