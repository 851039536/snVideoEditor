---
name: splitmerge-fix-logic-leaks-redundancy
overview: 修复 SplitMergeView.vue 中审查发现的 8 个问题：3 个内存/资源泄漏、3 个逻辑漏洞、2 个代码冗余。
todos:
  - id: fix-unmount-leaks
    content: 修复 onUnmounted：增加 clips 临时文件清理 + store.reset() 停止定时器
    status: completed
  - id: fix-mergevideos-false
    content: 修复 startProcess：mergeVideos 返回 false 时增加 else 分支调用 store.reset()；批量 deleteFile 改用 Promise.allSettled 增加错误处理
    status: completed
  - id: fix-hms-empty-input
    content: 修复 hmsFieldSetter：parseInt 后增加 || 0 兜底，移除 isNaN 提前返回
    status: completed
  - id: fix-mode-switch-preserve-files
    content: 修复 mode watch：切到 merge 时不再清空 files 数组，保留用户已添加的外部文件
    status: completed
  - id: fix-hms-redundancy
    content: 消除 HMS computed 冗余：新增 startParts/endParts 中间 computed，6 个 getter 改为从缓存读取
    status: completed
  - id: fix-cuttoclip-guard
    content: 修复 cutToClipList：开头增加 files.value.length===0 的防护判断
    status: completed
---

## 概要

修复 SplitMergeView.vue 中代码审查发现的 8 个问题，涵盖资源泄漏、逻辑漏洞和代码冗余三个类别。全部改动集中在 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 一个文件。

## 修复清单

### 资源泄漏（3 项）

1. **组件卸载时清理 clips 临时文件**：`onUnmounted` 中遍历所有 clips 的 `outputFile` 调用 `deleteFile`，避免临时目录文件堆积
2. **组件卸载时停止 progress store 定时器**：`onUnmounted` 中调用 `store.reset()`，停止 `setInterval` 定时器
3. **mergeVideos 返回 false 时重置 store**：在 `startProcess` 中为 `if (result)` 增加 `else` 分支调用 `store.reset()`，防止状态卡死在 `isProcessing=true`

### 逻辑漏洞（3 项）

4. **hmsFieldSetter 空输入修复**：将 `parseInt(s)` 改为 `parseInt(s) || 0`，使空字符串默认为 0，输入框自动恢复为 "00"，而非静默保留空白
5. **startProcess 批量 deleteFile 增加错误处理**：改用 `Promise.allSettled` 收集所有删除结果，失败时通过 `console.warn` 记录
6. **模式切换到 merge 时不再清空外部文件**：移除 `mode` watch 中 merge 分支的 `files.value = []`，保留用户已添加的外部文件

### 代码冗余（2 项）

7. **消除 6 次重复 secondsToHMS 调用**：新增 `startParts` 和 `endParts` 两个只读 computed，缓存 `secondsToHMS(trim).split(':')` 结果，6 个 writable computed 的 getter 从此读取
8. **cutToClipList 增加空数组防护**：函数开头增加 `if (files.value.length === 0) { errorMsg.value = '请先添加视频文件'; return }` 判断

## 技术方案

### 修改范围

仅修改 `src/renderer/src/views/SplitMerge/SplitMergeView.vue` 一个文件，不涉及其他模块。

### 实现要点

#### 1. onUnmounted 增强（第 568-574 行）

```ts
onUnmounted(() => {
  document.removeEventListener('pointermove', onGlobalPointerMove)
  document.removeEventListener('pointerup', onGlobalPointerUp)
  // 清理所有 clips 临时文件
  for (const c of clips.value) {
    window.electronAPI.deleteFile(c.outputFile).catch(() => {})
  }
  if (window.electronAPI) {
    window.electronAPI.removeProgressListener()
  }
  // 停止 progress store 定时器
  store.reset()
})
```

- 遍历 `clips.value` 调用 `deleteFile`，使用 `.catch(() => {})` 静默忽略删除失败
- 存储 reset 放在最后，确保先清理完其他资源再重置状态

#### 2. startProcess 双重修复（第 509-548 行）

- **mergeVideos 返回 false**：在 `if (result)` 后增加 `else { store.reset() }`
- **批量 deleteFile 错误处理**：将 `for` 循环改为 `Promise.allSettled`，收集失败项并 `console.warn`

```ts
if (result) {
  // 清理 temp 文件
  const deleteResults = await Promise.allSettled(
    clips.value.filter(c => c.selected).map(c => window.electronAPI.deleteFile(c.outputFile))
  )
  const failed = deleteResults.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(`合并后清理临时文件失败: ${failed} 个`)
  }
  clips.value = clips.value.filter(c => !c.selected)
  store.finish()
} else {
  store.reset()
}
```

#### 3. hmsFieldSetter 修复（第 47-48 行）

将：

```ts
const total = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)
if (isNaN(total)) { return }
```

改为：

```ts
const hNum = parseInt(h) || 0
const mNum = parseInt(m) || 0
const sNum = parseInt(s) || 0
const total = hNum * 3600 + mNum * 60 + sNum
```

移除 `if (isNaN(total)) { return }` 判断，因为 `|| 0` 保证 total 始终有效。

#### 4. 模式切换保留文件（第 245-250 行）

移除 merge 分支中的 `files.value = []`，仅保留：

```ts
} else if (newMode === 'merge') {
  outputName.value = ''
  outputDir.value = ''
  errorMsg.value = ''
}
```

用户可在 split/merge 间来回切换而不丢失合并模式下添加的外部文件。

#### 5. HMS computed 去冗余（第 61-85 行）

新增两个只读中间 computed：

```ts
const startParts = computed(() => secondsToHMS(trimStartSec.value).split(':'))
const endParts = computed(() => secondsToHMS(trimEndSec.value).split(':'))
```

6 个 writable computed 的 getter 改为直接读取 `startParts.value[0/1/2]` 和 `endParts.value[0/1/2]`，减少从 6 次到 2 次 `secondsToHMS` 调用。

#### 6. cutToClipList 防护（第 429 行）

函数开头增加：

```ts
if (files.value.length === 0) {
  errorMsg.value = '请先添加视频文件'
  return
}
```

### 兼容性

所有改动向后兼容，不改变任何 API 接口或数据流，不影响其他模块。