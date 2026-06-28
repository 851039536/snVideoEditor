---
name: refactor-encrypt-view
overview: 审查 EncryptView.vue 逻辑，删除冗余代码并优化不一致之处，包括移除冗余的 CryptoEntry.name 字段、内联单次调用的 setVideoMeta 包装函数、将 canStart 从普通函数改为 computed、合并 addFileEntry/addFiles 二函数模式。
todos:
  - id: remove-name-field
    content: 移除 `CryptoEntry.name` 冗余字段，模板统一使用 `getFileName(file.path)`
    status: completed
  - id: inline-setvideometa
    content: 内联 `setVideoMeta` 函数到两处调用点
    status: completed
  - id: canstart-to-computed
    content: 将 `canStart` 从普通函数改为 `computed`，同步模板调用方式
    status: completed
  - id: merge-addfile-functions
    content: 合并 `addFileEntry` 和 `addFiles`，消除二函数模式
    status: completed
---

## 需求概述

审查并精简 `src/renderer/src/views/Encrypt/EncryptView.vue` 中的冗余代码，提高代码质量和与项目其他视图的一致性。

## 核心改动

1. **移除 `CryptoEntry.name` 冗余字段**：`name` 字段的逻辑与 `utils/format.ts` 中的 `getFileName()` 完全相同，模板中统一使用 `getFileName(file.path)` 替代
2. **内联 `setVideoMeta` 函数**：该函数仅做 2 行赋值（`videoMeta.value` + `duration.value`），且仅有 2 处调用点，无需单独封装
3. **将 `canStart` 改为 `computed`**：当前为普通函数，而 CompressView、GifConvertView 中均使用 `computed`，应保持一致风格
4. **合并 `addFileEntry`/`addFiles` 二函数模式**：`addFileEntry` 仅被 `addFiles` 和 `selectDir` 内部调用，可将去重和 IPC 逻辑整合到 `addFiles` 中作为唯一入口

## 技术方案

### 改动策略

在 `EncryptView.vue` 单文件内进行局部重构，不涉及其他文件修改，不改变任何外部接口和运行时行为。

### 改动细节

#### 1. 移除 `CryptoEntry.name` 字段

- 从 `CryptoEntry` 接口（第 19-23 行）中删除 `name: string`
- 移除 `addFileEntry` 中的 `name: p.split(/[/\\]/).pop() || p` 赋值（第 94 行）
- 模板第 474 行 `{{ file.name }}` 改为 `{{ getFileName(file.path) }}`
- 模板第 460 行已使用 `getFileName(files[0]?.path || '')`，无需改动

#### 2. 内联 `setVideoMeta`

- 删除第 128-131 行的 `setVideoMeta` 函数定义
- 在第 195 行调用处替换为：

```ts
videoMeta.value = meta as VideoMeta
duration.value = (meta as VideoMeta).duration
```

- 在第 211 行调用处替换为：

```ts
videoMeta.value = meta as VideoMeta
duration.value = meta.duration
```

#### 3. `canStart` 改为 `computed`

- 将第 295-300 行 `function canStart(): boolean { ... }` 改为 `const canStart = computed((): boolean => { ... })`
- 模板中 `canStart()` 改为 `canStart`（computed 无需调用括号）

#### 4. 合并 `addFileEntry` / `addFiles`

- 将 `addFileEntry` 的逻辑内联到 `addFiles` 中
- 删去独立的 `addFileEntry` 函数
- `selectDir` 中 `await addFileEntry(p)` 改为直接调用合并后的 `addFiles([p])`

### 不变部分

- 密码强度逻辑、视频播放控制、解密预览流程、进度监听、`onUnmounted` 清理逻辑均保持不变
- 模板结构、样式、Tailwind class 不变
- 导入语句不变（`getFileName` 已导入，移除 `name` 不影响）