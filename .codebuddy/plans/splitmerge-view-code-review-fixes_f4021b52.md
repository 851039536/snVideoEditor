---
name: splitmerge-view-code-review-fixes
overview: 修复 SplitMergeView.vue 中的 3 个逻辑 BUG 和 6 处代码冗余：去重模式切换逻辑、修复空状态死代码、提取 clips 列表子组件、清理未使用类型和内联 handler。
todos:
  - id: fix-mode-switch
    content: 修复模式切换双重执行：删除 switchToSplit()，裁剪标签改为 @click="mode='split'"，由 watch 统一处理
    status: completed
  - id: extract-clip-list
    content: 新建 ClipList.vue 组件，用 showReorder prop 消除 split/merge 模式中 ~40 行重复模板
    status: completed
  - id: fix-empty-state
    content: 修复 merge 模式空状态死代码：将 v-if="clips.length===0" 移到父级 v-if 外部改用 v-else
    status: completed
    dependencies:
      - extract-clip-list
  - id: extract-inline-handlers
    content: 提取 @error 和 @loadedmetadata 内联 handler 为命名方法，loadedmetadata 同步更新 currentTime
    status: completed
  - id: clean-redundant-code
    content: 清理其余冗余：移除 dragging 中 'playhead' 类型、移除 timeline 冗余 @mousemove、修复 pause/ended 重复设值
    status: completed
  - id: verify-lint
    content: 运行 lint 校验确保零错误，验证无新增 TypeScript 类型错误
    status: completed
    dependencies:
      - fix-mode-switch
      - extract-clip-list
      - fix-empty-state
      - extract-inline-handlers
      - clean-redundant-code
---

## 用户需求

对 `SplitMergeView.vue` 进行代码优化，修复审查中发现的 3 个逻辑 BUG 和 6 处代码冗余，提升代码质量与可维护性。

## 核心修复项

### BUG 修复

1. **模式切换重复执行**：移除 `switchToSplit()` 函数，统一由 `watch(mode)` 处理模式切换副作用，消除 `loadVideoMeta()` 双次 IPC 请求
2. **空状态死代码**：将 merge 模式中"暂无片段"提示从 `v-if="clips.length > 0"` 父块内移出，使其能正常渲染
3. **loadedmetadata 未同步 currentTime**：将内联 handler 替换为命名方法 `onVideoLoaded`，同步更新 `currentTime.value`

### 冗余消除

4. 移除 `dragging` 类型中未使用的 `'playhead'`
5. 移除 timeline 元素上冗余的 `@mousemove="onTimelineMove"`（已被 document 级监听覆盖）
6. 在 `onVideoEnded` 中设守卫标志，避免 `onVideoPause` 重复设 `isPlaying=false`
7. 提取 `@error` 和 `@loadedmetadata` 内联箭头函数为命名方法 `onVideoError` / `onVideoLoaded`
8. 删除 `switchToSplit()` 函数（与 watcher body 重复）
9. 提取 clips 列表为独立子组件 `ClipList.vue`，消除 split/merge 模式中 ~40 行重复模板

## 技术方案

### 实现策略

在现有 Vue 3 + TypeScript + `<script setup>` 架构基础上进行局部重构，所有修改集中在 `SplitMergeView.vue` 和新组件 `ClipList.vue` 两个文件，不动其它模块。

### 核心改动

#### 1. 模式切换去重（BUG #1 + 冗余 #8）

**问题**：`switchToSplit()` 和 `watch(mode)` 包含完全相同的逻辑，且 `switchToSplit` 设置 `mode.value = 'split'` 会触发 watcher 导致双重执行。

**方案**：删除 `switchToSplit()` 函数，裁剪标签点击改为 `@click="mode = 'split'"`，由 `watch(mode)` 统一处理：

- Tab 点击只负责修改 `mode` 值
- Watcher 统一响应模式变更，调用 `loadFirstFileOnly()` + `loadVideoMeta()`
- 合并标签也统一为 `@click="mode = 'merge'"`（无需额外逻辑）

#### 2. 提取 ClipList 子组件（冗余 #9）

**方案**：新建 `src/renderer/src/components/ClipList.vue`，用 `showReorder` prop 区分 split/merge 两种模式的行为差异：

| 属性 | Split 模式 | Merge 模式 |
| --- | --- | --- |
| 标题 | "已裁切片段（N 个）" | "裁切片断（勾选 N / M）" |
| Checkbox | 有 | 有 |
| 排序按钮 (ArrowUp/ArrowDown) | 无 | 有 |
| 删除按钮 (X) | 有 | 有 |


组件接口：

- **Props**: `clips: ClipItem[]`, `showReorder: boolean`, `selectedCount: number`
- **Emits**: `toggle(index)`, `remove(index)`, `move(index, direction)`

#### 3. 空状态死代码修复（BUG #2）

在 merge 模式中，将 `<p v-if="clips.length === 0">` 移到 `v-if="clips.length > 0"` 的 `<div>` 外部，改为：

```html
<div v-if="clips.length > 0">...</div>
<p v-else>暂无片段，请先在裁剪模式下添加</p>
```

#### 4. 内联 handler 提取（BUG #3 + 冗余 #7）

```typescript
function onVideoError(e: Event): void {
  const video = e.target as HTMLVideoElement
  errorMsg.value = `视频加载失败: ${video?.error?.message || '未知错误'}`
}

function onVideoLoaded(): void {
  if (videoPlayer.value) {
    videoPlayer.value.currentTime = trimStartSec.value
    currentTime.value = trimStartSec.value
  }
}
```

#### 5. Timeline 事件清理（冗余 #4 + #5）

- `dragging` 类型从 `'start' | 'end' | 'playhead' | null` 改为 `'start' | 'end' | null`
- 移除 timeline `<div>` 上的 `@mousemove="onTimelineMove"`（保留 `@click`）

#### 6. pause/ended 重复设值修复（冗余 #6）

在 `onVideoEnded` 中设模块级标志 `endedGuard = true`，`onVideoPause` 检查该标志：

```typescript
let endedGuard = false

function onVideoPause(): void {
  if (endedGuard) { endedGuard = false; return }
  isPlaying.value = false
}

function onVideoEnded(): void {
  endedGuard = true
  isPlaying.value = false
}
```

### 目录结构

```
src/renderer/src/
├── components/
│   ├── ClipList.vue          # [NEW] 可复用的片段列表组件
│   ├── FileDropZone.vue      # [不变]
│   ├── ProgressPanel.vue     # [不变]
│   ├── SideNav.vue           # [不变]
│   ├── TitleBar.vue          # [不变]
│   └── VideoPreview.vue      # [不变]
└── views/
    └── SplitMergeView.vue    # [MODIFY] 主修改目标，约 -60 行
```

### 影响范围

- 仅修改 `SplitMergeView.vue`（删除 switchToSplit、调整模板、提取 handler）
- 新增 `ClipList.vue` 组件（约 60 行模板 + 脚本）
- 不涉及 store、preload、主进程、路由等任何其它模块
- 不改动现有功能行为