---
name: compress-view-extension
overview: 对 CompressView 模块进行 8 项改进：样式提取为 SCSS partial、拆分 VideoDetailModal 组件、压缩预设持久化、前后对比展示、失败文件明细、CRF 标签修正、移除死代码、添加 preset/2-pass 编码选项。
todos:
  - id: create-scss-partial
    content: 创建 _compress.scss 并提取 CompressView.vue 中的滑块、模态框、过渡动画样式
    status: completed
  - id: extract-video-detail-modal
    content: 拆分 VideoDetailModal.vue 组件，从 CompressView.vue 中移除模态框相关模板/脚本/样式
    status: completed
  - id: settings-persistence
    content: 在 settings.ts 新增 compressPreset state + localStorage 持久化，CompressView 参数初始化关联 store
    status: completed
  - id: main-process-preset-twopass
    content: 更新 ffmpeg.ts CompressOptions/BatchCompressOptions 接口 + compressVideo 实现 preset/2-pass + batchCompress 返回 successFiles
    status: completed
  - id: ipc-preload-sync
    content: 同步更新 main/index.ts IPC 泛型参数和 preload/index.ts 方法签名
    status: completed
    dependencies:
      - main-process-preset-twopass
  - id: ui-polish
    content: CRF 标签修正 + 移除死代码分支 + 压缩前后对比展示 + 失败文件明细报告 + preset/2-pass UI 控件
    status: completed
    dependencies:
      - create-scss-partial
      - extract-video-detail-modal
      - settings-persistence
      - ipc-preload-sync
  - id: arch-review
    content: 使用 [skill:universal-arch-skill] 审查 Compress 模块架构合规性
    status: completed
    dependencies:
      - ui-polish
---

## 用户需求

对 CompressView.vue 执行 8 项改进：

1. **样式提取为 SCSS partial** — 当前 `<style scoped>` 块共 97 行，远超项目规定的 10 行上限。将滑块样式、模态框样式、过渡动画样式全部提取到 `assets/styles/_compress.scss`，CompressView.vue 仅保留 `@use` 导入 + 必要的 CSS 变量覆盖。

2. **拆分 VideoDetailModal 组件** — 视频详情模态框（template 429-499 行 + script 18-42 行 + 相关样式约 70 行）独立为 `views/Compress/VideoDetailModal.vue` 组件，接收 `entry: FileEntry | null` prop 和 `close` emit。

3. **压缩预设持久化到 settings store** — CRF 值、分辨率、编码格式、音频码率、编码速度 preset、2-pass 开关共 6 个参数保存到 localStorage，下次打开页面自动恢复上次的压缩配置。

4. **压缩前后对比展示** — 批量压缩完成后，展示每个成功文件的原始大小、压缩后大小、节省百分比。batchCompress 需返回成功文件的输出路径列表供前端查询文件尺寸。

5. **失败文件明细报告** — 当前仅显示 "N 个文件压缩失败"，需改为列出具体失败文件路径的明细列表。

6. **CRF 标签修正** — 当前 "无损/最佳/默认/低质量" 不准确（CRF 0 才是真无损，CRF 18 是视觉无损），改为 "0(真无损) / 18(视觉无损) / 23(默认) / 28(标清) / 51(最差)"。

7. **移除死代码 "压缩中..." 分支** — 第 422 行按钮的 `progressStore.isProcessing ? '压缩中...'` 分支永不可达（按钮在 isProcessing 时 disabled），需移除。

8. **添加 preset/2-pass 编码选项** — 添加 `-preset` 速度选择（ultrafast/superfast/veryfast/faster/fast/medium/slow/slower/veryslow），仅对 CPU 编码器有效；bitrate 模式下可选 2-pass 编码以提升画质，仅在非 GPU 编码时可用。

## 技术栈

- **前端**: Vue 3 Composition API + TypeScript + Pinia + SCSS
- **主进程**: Electron + Node.js + fluent-ffmpeg (ffmpeg CLI spawn)
- **IPC**: Electron contextBridge + ipcMain.handle (wrapOperation 模式)

## 实现方案

### 整体策略

采用渐进式重构：先提取样式和组件以降低文件复杂度，再添加新功能。所有改动向后兼容，预设默认值保持与当前行为一致。

### 关键决策

**1. 2-pass 编码实现**
在 `compressVideo` 函数内部，bitrate 模式 + twoPass=true + 非 GPU 时，拆分为两次 ffmpeg spawn：

- Pass 1: 分析 pass，输出到 `NUL`(Windows) / `/dev/null`(Unix)，不解析进度
- Pass 2: 真实编码 pass，输出到目标文件，正常解析进度
- 两次 spawn 共享相同的基础参数（codec/bitrate/resolution/audio/preset）
- Pass 2 完成后清理 `ffmpeg2pass-0.log` 和 `ffmpeg2pass-0.log.mbtree`

**2. batchCompress 返回类型扩展**
从 `{ success: number; failed: string[] }` 扩展为 `{ success: number; successFiles: string[]; failed: string[] }`，其中 `successFiles` 为成功的输出文件路径。渲染进程用此列表查询各输出文件的实际大小，实现压缩前后对比。

**3. 预设持久化**
利用 Pinia store + localStorage，在 `settings.ts` 中新增 `compressPreset` 对象（含 6 个字段）。初始化时从 localStorage 读取，watch 自动回写。CompressView 中所有参数 ref 从 store 初始化。

### 目录结构

```
src/
├── renderer/src/
│   ├── views/Compress/
│   │   ├── CompressView.vue          # [MODIFY] 主视图，从 600 行缩减至约 380 行（移除模态框+样式）
│   │   └── VideoDetailModal.vue      # [NEW] 视频详情模态框组件，约 120 行（含 template/script/style）
│   ├── stores/
│   │   └── settings.ts               # [MODIFY] 新增 compressPreset state + localStorage 持久化
│   ├── assets/styles/
│   │   └── _compress.scss            # [NEW] 压缩视图 SCSS partial，约 85 行（滑块/模态框/过渡动画）
├── main/
│   └── modules/
│       └── ffmpeg.ts                 # [MODIFY] CompressOptions/BatchCompressOptions 新增 preset+twoPass；compressVideo 实现 2-pass；batchCompress 返回 successFiles
├── main/
│   └── index.ts                      # [MODIFY] 更新 video:compress 和 video:batchCompress 的 wrapOperation 泛型参数
├── preload/
│   └── index.ts                      # [MODIFY] 更新 compressVideo/batchCompress 方法签名
```

## 实现细节

### 1. _compress.scss 内容划分

- `.slider` 滑块渐变色与滑块 thumb 样式（当前 503-512 行）
- `.detail-overlay` / `.detail-modal` / `.detail-header` / `.detail-loading` 模态框结构样式
- `.detail-grid` / `.detail-item` / `.detail-label` / `.detail-value` 详情网格样式
- `.modal-fade-*` 过渡动画样式

### 2. VideoDetailModal.vue 组件接口

```typescript
// Props
interface Props {
  entry: FileEntry | null
}
// Emits
// emit('close')
```

组件内部管理 `detailLoading` 状态和 `getVideoMeta` 异步调用。通过 Teleport 渲染到 body。

### 3. settings.ts 新增 compressPreset

```typescript
interface CompressPreset {
  crfValue: number       // 默认 23
  resolution: string     // 默认 'original'
  bitrate: string        // 默认 ''
  codec: string          // 默认 'libx264'
  audioBitrate: string   // 默认 '32k'
  preset: string         // 默认 'fast'
  twoPass: boolean       // 默认 false
}
```

localStorage key: `snve-compress-preset`，JSON 序列化存储。

### 4. ffmpeg.ts 关键改动

- `CompressOptions` 接口新增 `preset?: string` 和 `twoPass?: boolean`
- 第 555 行硬编码 `'fast'` 改为 `opts.preset || 'fast'`
- 2-pass 仅在 `opts.twoPass && opts.bitrate && !isGpu` 时触发，pass 1 结束后检查 `isCancelled`
- 2-pass 临时日志文件在 pass 2 结束后清理（`fs.unlinkSync` 包裹在 try-catch 中）

### 5. 前后对比实现

渲染进程在 `batchCompress` resolve 后，对 `result.successFiles` 中的每个输出路径调用 `window.electronAPI.getVideoMeta()` 或 `getFileInfo()` 获取文件大小。在 ProgressPanel 下方展示对比表格：文件名 | 原始大小 | 压缩后大小 | 节省百分比。

### 6. 性能考量

- 2-pass 编码耗时约为单 pass 的 1.8-2.2 倍（pass 1 仅分析不写文件，速度快于 pass 2）
- preset 越慢（如 veryslow）越耗时，默认 fast 保持当前行为不退化
- 压缩前后对比的文件尺寸查询利用现有 IPC 通道，无额外主进程负担

## 使用的 Agent 扩展

### Skill

- **universal-arch-skill**
- 用途：在实施完成后对 Compress 模块进行架构合规性审查，确保样式分离、注册完整性、设计 Token 等 6 大原则未引入违规
- 预期结果：输出架构审查报告，确认新代码符合项目架构规范（`@use` 第一行、无硬编码颜色、样式分离、if 带花括号等）

### SubAgent

- **code-explorer**
- 用途：在实现过程中快速定位跨文件引用（如 settings.ts 的 watch 模式、其他视图如何使用 settings store），确保新增持久化逻辑与现有模式一致
- 预期结果：确认 settings store 的 watch/localStorage 模式可被 CompressView 复用