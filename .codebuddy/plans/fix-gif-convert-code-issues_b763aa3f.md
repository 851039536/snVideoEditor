---
name: fix-gif-convert-code-issues
overview: 修复 GifConvertView.vue 中审查发现的 4 个问题：按钮语义矛盾、时间轴拖拽无条件写入、无效的 releasePointerCapture、以及代码冗余。
todos:
  - id: fix-all-review-issues
    content: 修复 GifConvertView.vue 中审查发现的所有问题：P0 按钮标签语义、P1 onTimelineMove 值守卫、P2 无效 releasePointerCapture、P3 死代码 fallback 和静态数组外提
    status: completed
---

## 修复范围

对 `src/renderer/src/views/Gif/GifConvertView.vue` 执行四项精确修复，解决上一轮代码审查中发现的所有逻辑漏洞和冗余。

## 修复清单

### P0：`enableTrim` 按钮标签语义矛盾

- `enableTrim=false` 时按钮显示"关闭"，但点击实际启用截取，用户困惑
- 改为：`false` 时显示"启用截取"，`true` 时显示"已启用"
- 同步更新提示文字：从"点击「关闭」按钮启用截取"改为"点击「启用截取」按钮启用截取"

### P1：`onTimelineMove` 缺少值变化守卫

- 每次 `pointermove` 都无条件写入 `trimStartSec.value` / `trimEndSec.value` 并调用 `seekVideoPlayer`
- 参照 SplitMergeView（第 406-410 行），为两个分支添加 `if (trimStartSec.value !== clamped)` 守卫，避免不必要的响应式更新和视频 seek

### P2：无效的 `releasePointerCapture` 调用

- `onGlobalPointerUp` 中对 `e.target` 调用 `releasePointerCapture` 无效——捕获是在 handle 元素上设置的，浏览器在 `pointerup` 时自动释放
- 删除 `(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)` 行

### P3：死代码与静态数组位置

- `qualityFactors[selectedQuality.value] || 0.4` 的 fallback 永不会命中（类型保证 key 存在），删除 `|| 0.4`
- 将静态数组 `qualityPresets` 和 `widthOptions` 移到 `<script setup>` 模块顶层（当前在组件实例内部，每次渲染重新创建）

## 技术方案

### 修改策略

单文件 `GifConvertView.vue` 中执行 4 处精确编辑，不涉及架构变更或新文件。

### 具体修改

#### 1. P3：静态数组外提（先行修改，影响面最小）

将 `qualityPresets` 和 `widthOptions` 从组件实例内部移到 `import` 语句之后、`<script setup>` 逻辑之前：

```ts
// 模块顶层常量
const QUALITY_PRESETS: QualityPreset[] = [...]
const WIDTH_OPTIONS = [...]
```

模板中对 `qualityPresets` 和 `widthOptions` 的引用不变（Vue 模板可直接访问模块顶层变量）。

#### 2. P0：按钮标签和提示文字

```html
<!-- 按钮标签 -->
{{ enableTrim ? '已启用' : '启用截取' }}

<!-- 提示文字 -->
拖拽下方摇杆选取范围，点击「启用截取」按钮启用截取
```

#### 3. P1：`onTimelineMove` 值变化守卫

参照 SplitMergeView 模式，在赋值前添加比较：

```ts
if (dragging.value === 'start') {
  const clamped = clamp(t, 0, trimEndSec.value - MIN_TRIM_GAP)
  if (trimStartSec.value !== clamped) {
    trimStartSec.value = clamped
    seekVideoPlayer(clamped)
  }
} else {
  const clamped = clamp(t, trimStartSec.value + MIN_TRIM_GAP, maxDuration.value)
  if (trimEndSec.value !== clamped) {
    trimEndSec.value = clamped
    seekVideoPlayer(clamped)
  }
}
```

#### 4. P2：删除无效 `releasePointerCapture`

```ts
function onGlobalPointerUp(_e: PointerEvent): void {
  if (!dragging.value) { return }
  dragging.value = null
}
```

#### 5. P3：删除永不命中的 fallback

```ts
const factor = qualityFactors[selectedQuality.value]  // 去掉 || 0.4
```

### 不变更范围

- Template 结构不变
- Style 不变
- 数据流和响应式架构不变
- 其他函数逻辑不变