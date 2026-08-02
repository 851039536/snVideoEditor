# SplitMerge 目录审查与修复计划

## 摘要

对 `src/renderer/src/views/SplitMerge/` 下 4 个文件进行冗余与逻辑漏洞审查，发现 8 个真实 bug、3 处冗余代码、若干风格违规。采用**就地最小修复**策略：将 AudioSplitMergeView 对齐到 SplitMergeView 已有的正确模式（竞态防护、资源释放、拖拽检查），并修复两视图共有的精度丢失与卸载失联缺陷。**不提取跨文件共享 composable**（AGENTS.md 明确禁止主动发起纯重构）。

## 问题清单（已验证）

### P0 — 严重逻辑漏洞

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| F1 | `SplitMergeView.vue` | 161 | **speed 模式 addFiles 不加载元数据**：`if (mode.value === 'split' && files.value.length > 0)` 不含 `'speed'`，导致 speed 模式直接添加文件后 duration=0、时间轴不可用。watch(mode) 切换时虽会重载，但用户直接在 speed 模式添加文件即触发 |
| F2 | `AudioSplitMergeView.vue` | 128-139 | **loadAudioMeta 无竞态保护**：缺少 `loadRequestId` 守卫，快速替换音频时旧请求 resolve 后覆盖新状态。对比 SplitMergeView line 104,170-178 已有防护 |
| F3 | `AudioSplitMergeView.vue` | 141-148 | **removeFile 清空 clips 不删临时文件**：`clips.value = []` 前未遍历 `deleteFile(clip.outputFile)`，磁盘泄漏 |

### P1 — 资源/正确性缺陷

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| F4 | `AudioSplitMergeView.vue` | 31, 475 | **内联 play 按钮未用 togglePlay**：`useAudioPlayer` 已导出 `togglePlay`（含 try-catch 处理 autoplay 拒绝），但未从解构中取出，模板用内联 `ap.play()` 无 catch |
| F5 | `AudioSplitMergeView.vue` | 165-167 | **onReplaceDragLeave 缺 relatedTarget 检查**：直接置 false，拖拽经过子元素时遮罩闪烁。对比 SplitMergeView line 235-241 正确实现 |
| F6 | `AudioSplitMergeView.vue` | 347-353 | **watch(mode) 两缺陷**：(a) 切到 merge 未释放音频资源（对比 SplitMergeView line 272-277 调用 `releaseVideoResource()`+`resetVideoState()`+清空 files）；(b) 切回 split 时 `!audioMeta.value` 条件阻止重载，files[0] 已变更时 audioMeta 指向旧文件 |
| F7 | `time.ts` + 两视图 | time.ts:7, Split:337-338, Audio:224-225 | **裁切时长精度丢失**：`secondsToHMS` 用 `Math.floor` 丢小数（30.5s→"00:00:30"），传给 ffmpeg `-ss`/`-t` 导致起止边界各丢 0.x 秒 |
| F8 | 两视图 | Split:479-492, Audio:365-383 | **卸载期间操作失联**：`onUnmounted` 调用 `store.reset()` 使 isProcessing=false，但不取消主进程 ffmpeg。后果：进度丢失、锁超时自动释放后用户可发起新操作致 `setFfmpegProc` 覆盖→双 ffmpeg 并发；cutToClipList 成功后 push 到已销毁组件，临时文件无人清理 |

### 冗余代码

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| R1 | `AudioSplitMergeView.vue` | 150-156, 271-277 | `moveFile`/`moveClip` 内联 `swapArrayElements` 逻辑，与 SplitMergeView line 144-151 的已提取函数完全重复 |
| R2 | `AudioSplitMergeView.vue` | 365-374 | `onUnmounted` 内联音频释放逻辑，未提取为 `releaseAudioResource()` 函数，导致 onReplaceDrop/removeFile 无法复用 |
| R3 | `AudioSplitMergeView.vue` | 165-167 | onReplaceDragLeave 实现与 SplitMergeView 不一致（F5 的根源即此冗余） |

### 风格违规

| # | 文件 | 问题 |
|---|------|------|
| S1 | `SplitMergeView.vue` | 约 15 处英文注释块标题（`// ---- Mode ----` 等），违反 AGENTS.md「注释语言统一使用中文」 |
| S2 | `SpeedPanel.vue` | `outputDir` 不随 `props.inputFile` 变化重置（替换视频后保留旧路径） |
| S3 | `SplitMergeView.vue` line 264-279 | `watch(mode)` 不清 `errorMsg`（对比音频版 line 348 会清） |

## 修复步骤

### 步骤 1 — 修复 F1：speed 模式加载元数据
- 文件：`src/renderer/src/views/SplitMerge/SplitMergeView.vue` line 161
- 改动：`if (mode.value === 'split' && ...)` → `if ((mode.value === 'split' || mode.value === 'speed') && files.value.length > 0)`
- 回归风险：极低，仅扩展条件

### 步骤 2 — 修复 F2：AudioSplitMergeView 添加竞态防护
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue`
- line 86 附近（`clipIdCounter` 声明旁）添加 `let loadRequestId = 0`
- line 128-139 `loadAudioMeta` 改为：
  - 进入时 `const thisRequestId = ++loadRequestId`
  - await 后检查 `if (thisRequestId !== loadRequestId) return`
  - 检查 `if (files.value.length === 0 || files.value[0] !== filePath) return`
  - catch 内同样检查 `thisRequestId !== loadRequestId` 才设 errorMsg
- 对齐 SplitMergeView line 169-191 的模式

### 步骤 3 — 修复 R2 + F6(a)：提取 releaseAudioResource 并在多处使用
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue`
- 在 `loadAudioMeta` 前（约 line 127）新增：
  ```ts
  /** 释放音频元素资源，避免 file:/// 延迟释放导致文件句柄占用 */
  function releaseAudioResource(): void {
    const ap = audioPlayer.value
    if (ap) { ap.pause(); ap.removeAttribute('src'); ap.load() }
  }
  ```
- line 169-184 `onReplaceDrop`：在 `files.value = [filePath]` 前调用 `releaseAudioResource()`
- line 141-148 `removeFile`（见步骤 4）中使用 `releaseAudioResource()`
- line 365-374 `onUnmounted`：将内联释放逻辑替换为 `releaseAudioResource()` 调用
- line 347-353 `watch(mode)` 切到 merge 时调用 `releaseAudioResource()`（对齐 SplitMergeView 的 `releaseVideoResource()`）

### 步骤 4 — 修复 F3：removeFile 清空时删除临时文件并释放资源
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue` line 141-148
- 改为：
  ```ts
  function removeFile(index: number): void {
    files.value.splice(index, 1)
    if (files.value.length === 0) {
      releaseAudioResource()
      for (const c of clips.value) {
        window.electronAPI.deleteFile(c.outputFile).catch(() => {})
      }
      audioMeta.value = null
      duration.value = 0
      clips.value = []
    }
  }
  ```
- 依赖：步骤 3（releaseAudioResource 函数）

### 步骤 5 — 修复 F6(b)：watch(mode) 切回 split 时重新加载
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue` line 350
- 改动：去掉 `!audioMeta.value` 条件，改为 `if (newMode === 'split' && files.value.length > 0)`
- 配合步骤 2 的 loadRequestId，过时请求被丢弃；冗余 ffprobe 调用仅在模式切换时发生，可接受
- 依赖：步骤 2

### 步骤 6 — 修复 F5：onReplaceDragLeave 添加 relatedTarget 检查
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue` line 165-167
- 改为：
  ```ts
  function onReplaceDragLeave(e: DragEvent): void {
    const container = e.currentTarget as HTMLElement
    if (!e.relatedTarget || !container.contains(e.relatedTarget as HTMLElement)) {
      isDraggingReplace.value = false
    }
  }
  ```
- 模板对应 `@dragleave="onReplaceDragLeave"` → `@dragleave="onReplaceDragLeave($event)"`（确认模板处）

### 步骤 7 — 修复 F4：解构 togglePlay 并替换内联按钮
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue`
- line 31 解构补充 `togglePlay`
- line 475 模板：`@click="() => { const ap = audioPlayer; if (ap) { ap.paused ? ap.play() : ap.pause() } }"` → `@click="togglePlay"`

### 步骤 8 — 修复 R1：复用 swapArrayElements
- 文件：`src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue` line 150-156, 271-277
- 将 `moveFile`/`moveClip` 内联交换改为调用 SplitMergeView 已有的 `swapArrayElements`。但该函数定义在 SplitMergeView 内部（line 144-151），AudioSplitMergeView 无法直接导入。
- 方案：将 `swapArrayElements` 移至 `src/renderer/src/utils/math.ts`（与 `clamp` 同位），两视图均 import。满足 Rule of Three（4 处使用）。
- 文件：`src/renderer/src/utils/math.ts`（新增导出）、两视图（改 import 并替换内联逻辑）

### 步骤 9 — 修复 F7：裁切时长精度
- 文件：`src/renderer/src/utils/time.ts`
- 新增 `secondsToTimecode(totalSec)`：保留毫秒，输出 `HH:MM:SS.mmm` 格式（ffmpeg `-ss`/`-t` 原生支持）
- 文件：`SplitMergeView.vue` line 337-338、`AudioSplitMergeView.vue` line 224-225
- `startTime`/`duration` 改用 `secondsToTimecode`；`trimDurationStr` 展示仍用 `secondsToHMS`
- 注意：`ffmpeg.ts` 进度计算的 `timeToSeconds(opts.duration)` 需确认能解析 `HH:MM:SS.mmm`（ffmpeg-shared.ts parseProgressLine 只解析 `time=`，不受影响）

### 步骤 10 — 修复 F8：卸载期间取消操作
- 文件：`SplitMergeView.vue` line 479-492、`AudioSplitMergeView.vue` line 365-383
- `onUnmounted` 中：若 `store.isProcessing` 为真，先调用 `window.electronAPI.cancelOperation()` 再 `removeProgressListener()`/`store.reset()`
- 避免锁超时后用户发起新操作导致 `setFfmpegProc` 覆盖→双 ffmpeg 并发
- 注意：此改动会取消用户切走页面时正在运行的操作。当前架构下切走后进度面板不可见，取消更安全。需在 ProgressPanel 或 UI 提示"离开页面将取消操作"（可选增强）

### 步骤 11 — 修复 S1：SplitMergeView 注释改中文
- 文件：`src/renderer/src/views/SplitMerge/SplitMergeView.vue`
- 约 15 处英文注释块标题改为中文：`// ---- Mode ----`→`// ---- 模式 ----`、`// ---- Files ----`→`// ---- 文件 ----`、`// ---- Trim Timeline composable ----`→`// ---- 时间轴 composable ----` 等
- 行内英文注释（如 line 173-176 的 `// Guard: discard stale...`）改中文

### 步骤 12 — 修复 S2/S3：小修补
- 文件：`SpeedPanel.vue` line 23：添加 `watch(() => props.inputFile, () => { outputDir.value = '' })`
- 文件：`SplitMergeView.vue` line 264-279 `watch(mode)`：补充 `errorMsg.value = ''`（对齐音频版 line 348）

## 依赖关系

```
步骤1 (F1) ───────────── 无依赖，独立
步骤2 (F2) ───────────── 无依赖，独立
步骤3 (R2+F6a) ───────── 无依赖，独立
步骤4 (F3) ──── 依赖步骤3 (releaseAudioResource)
步骤5 (F6b) ─── 依赖步骤2 (loadRequestId 防护)
步骤6 (F5) ───────────── 无依赖，独立
步骤7 (F4) ───────────── 无依赖，独立
步骤8 (R1) ──── 需先改 utils/math.ts，再改两视图
步骤9 (F7) ──── 需先改 utils/time.ts，再改两视图
步骤10 (F8) ─── 独立（改两视图 onUnmounted）
步骤11 (S1) ─── 独立
步骤12 (S2/S3) ── 独立
```

步骤 1/2/3/6/7/10/11/12 可并行。步骤 4 依赖 3，步骤 5 依赖 2，步骤 8/9 各自串行（utils 先行）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 步骤 9 `secondsToTimecode` 影响 ffmpeg 参数解析 | ffmpeg `-ss`/`-t` 原生支持 `HH:MM:SS.mmm`；parseProgressLine 只解析 `time=` 不受影响；改后验证裁切边界（30.5s、0.1s） |
| 步骤 10 卸载即取消可能误杀用户想后台跑的操作 | 当前架构切走后进度不可见，取消更安全（避免双 ffmpeg 并发）；可加 UI 提示 |
| 步骤 5 去掉 `!audioMeta.value` 致每次切回 split 重载 | 配合步骤 2 loadRequestId 丢弃过时请求；ffprobe 轻量探测，延迟极小 |
| 步骤 8 改动 utils/math.ts 影响其他使用 swapArrayElements 的地方 | 当前仅 SplitMergeView 使用，移至 utils 后行为不变，其他模块按需 import |
| 多步骤同改 AudioSplitMergeView 增加合并冲突 | 所有改动在同一文件内按步骤线性修改；步骤 3 的 releaseAudioResource 提取先行，后续步骤引用 |

## 被拒绝的替代方案

1. **提取 useSplitMerge / useClipManager / useMergeProcess composable**（Agent A 步骤 1-5、Agent B Step 6）：虽能消除 60-70% 跨文件重复，但 AGENTS.md 明确「禁止主动发起纯重构」，且改动面大、回归风险高。R1/R2 冗余通过步骤 3/8 小幅消除即可。
2. **主进程 ffmpeg.ts 性能优化**（Agent B Step 7：stderr 定长缓冲、probeDuration 限流）：超出"SplitMerge 目录审查"范围，且属纯重构。stderr 累积在长操作时有内存影响，但本轮聚焦渲染层漏洞。
3. **合并兼容性预校验**（Agent B Step 5）：`mergeVideos` 用 `-c copy` concat 无编码校验，合并异构片段会静默失败。这是真实问题但属主进程逻辑，且需新增 ffprobe 校验流程，超出本轮范围。建议作为后续增强项。
4. **SpeedPanel 进度监听器自管理解耦**（Agent A 步骤 10）：当前 SpeedPanel 作为子组件渲染时父组件 SplitMergeView 仍挂载并注册监听器，功能正确。自管理会引入双重注册风险，收益不抵风险，仅添加注释说明依赖关系即可。

## 关键文件

1. `src/renderer/src/views/SplitMerge/AudioSplitMergeView.vue`（711 行）— 8 个 bug 中 6 个在此，修复核心
2. `src/renderer/src/views/SplitMerge/SplitMergeView.vue`（939 行）— F1/F7/F8/S1 所在，且作为音频视图的参照正确模式
3. `src/renderer/src/utils/time.ts`（38 行）— F7 精度修复，新增 secondsToTimecode
4. `src/renderer/src/utils/math.ts` — R1 修复，新增 swapArrayElements 导出
5. `src/renderer/src/views/SplitMerge/SpeedPanel.vue`（154 行）— S2 小修补
