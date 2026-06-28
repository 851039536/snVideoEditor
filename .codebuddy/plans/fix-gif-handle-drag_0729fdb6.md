---
name: fix-gif-handle-drag
overview: 修复 GifConvertView 中时间轴手柄拖拽失效问题：将 mousedown/mousemove/mouseup 事件体系改为与 SplitMergeView 一致的 pointerdown/pointermove/pointerup + setPointerCapture 方案。
todos:
  - id: fix-gif-handle-drag
    content: "修复 GifConvertView.vue 中的 trim 手柄拖拽：将 mousedown/mousemove/mouseup 全部切换为 pointerdown/pointermove/pointerup，启用 setPointerCapture，并为遮罩层添加 pointer-events: none"
    status: completed
---

## 问题

在 Gif 视图加载视频后，时间轴上的 trim 手柄无法拖拽移动。

## 根因

对比同项目中正常工作的 `SplitMergeView.vue`，`GifConvertView.vue` 存在以下差异：

1. 手柄使用 `@mousedown` 事件而非 `@pointerdown`，未调用 `setPointerCapture`，导致拖拽时容易脱靶
2. 遮罩层 `.timeline-dimmed-l`/`.timeline-dimmed-r` 未设置 `pointer-events: none`，可能拦截落在手柄上的事件（手柄通过 `left: -8px`/`right: -8px` 部分延伸到遮罩区域）
3. 全局事件使用 `mousemove`/`mouseup` 而非 `pointermove`/`pointerup`

## 修复目标

将拖拽实现与 `SplitMergeView.vue` 对齐，恢复手柄正常拖拽功能。

## 技术方案

### 修改范围

仅修改 `src/renderer/src/views/Gif/GifConvertView.vue` 一个文件，改动分为三部分：

1. **Script 部分**：将拖拽相关函数从 MouseEvent 体系切换到 PointerEvent 体系
2. **Template 部分**：手柄 `@mousedown` → `@pointerdown`
3. **Style 部分**：遮罩层添加 `pointer-events: none`

### 实现细节

#### Script 改动

| 位置 | 当前代码 | 修改为 |
| --- | --- | --- |
| `startHandleDrag` 参数 | `e: MouseEvent` | `e: PointerEvent`，函数体内添加 `(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)` |
| `onTimelineMove` 参数 | `e: MouseEvent` | `e: PointerEvent` |
| `onGlobalMouseMove` | 包装函数 | 重命名为 `onGlobalPointerMove`，参数改为 `e: PointerEvent` |
| `onGlobalMouseUp` | `(): void` | 重命名为 `onGlobalPointerUp`，参数改为 `e: PointerEvent`，函数体内添加 `(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)` |
| `onMounted` 监听 | `mousemove` / `mouseup` | `pointermove` / `pointerup` |
| `onUnmounted` 清理 | `removeEventListener` 对应名称 | 同步更新 |


#### Template 改动

```html
<!-- 当前 -->
@mousedown="startHandleDrag('start', $event)"
@mousedown="startHandleDrag('end', $event)"

<!-- 修改为 -->
@pointerdown="startHandleDrag('start', $event)"
@pointerdown="startHandleDrag('end', $event)"
```

#### Style 改动

在 scoped style 中 `.timeline-dimmed-l, .timeline-dimmed-r` 规则内添加 `pointer-events: none;`，防止遮罩层拦截本应落在手柄上的指针事件。

### 参考

完全参照 `SplitMergeView.vue` 的 `startHandleDrag`（第342-349行）、`onGlobalPointerUp`（第421-425行）及生命周期注册（第563-566行）的写法。