# Project Memory

## Code Style
- if 语句必须有花括号 `{}`，即使只有一行
- 禁止执行 `npm run build` 或 `dotnet build`，由用户自行验证
- Vue 组件使用 `<script setup lang="ts">` + Composition API

## Architecture Rules (6 Principles)
1. 功能模块化：每个视图独立目录，含主视图 + `types/index.ts`
2. 注册完整性：新增视图需同步更新 router + feature config
3. 类型安全单一数据源
4. 统一入口：跨功能操作通过 IPC 或 Pinia stores
5. 设计 Token：禁止硬编码颜色/间距/字体
6. 样式分离：`.vue` `<style>` 禁止内联 >10 行，提取到 SCSS partial

## Key Files
- `src/renderer/src/config/features.ts` — 功能元数据单一数据源
- `src/renderer/src/assets/styles/global.scss` — CSS 变量 + 全局 class
- `src/renderer/src/composables/useInfoTooltip.ts` — 信息提示气泡 composable

## CSS Variables
- Color tokens: `--color-warning` (#D29922), `--color-playhead` (#FF6B6B), `--color-accent-light` (#A78BFA)
- Design tokens: `--radius-sm` 4px, `--radius-base` 6px, `--radius-md` 8px, `--radius-lg` 12px
- Transition: `--transition-fast` 0.12s, `--transition-normal` 0.2s, `--transition-slow` 0.3s

## 2026-06-30: GifConvertView 代码审查与修复
- 创建 `views/Gif/types/index.ts`（QualityPreset + WidthOption 接口）
- 提取 58 行内联样式到 `assets/styles/_gif.scss`，@use 导入
- 修复硬编码颜色→SCSS `rgb()` 变量、`border-radius:10px`→`var(--radius-md)`
- 用 `hmsToSeconds()` 替代手动 h/m/s→秒计算
- 用 `getFileName()` 替代手动 `split().pop()`（2处）
- 用 lucide `Play`/`Pause` 图标替代内联 SVG
- `preset-btn` 死 class→`quality-preset-btn`，移除硬编码 `style=`
- `estimateOutputSize` 16:9 硬编码→使用视频实际宽高比，回退 16:9
- 验证通过：types/index.ts + _gif.scss 零 lint error，GifConvertView.vue 仅 pre-existing `@use` CSS 误报

## 2026-06-30: 全项目审查与四阶段优化

### Phase 1 — Bug 修复与清理
- `progress.ts`: start() 中 `type` 参数未使用 bug 已修复 → `type: type`
- `file.ts`: scanVideoFiles/scanPlayerFiles 合并为通用 `scanFiles()`，移除未使用的 ENCRYPTED_FILTER
- `PlaylistPanel.vue`: 📁 emoji → FolderOpen lucide 图标
- `package.json`: 移除未使用的 playwright、naive-ui 依赖
- `settings.ts`: 移除 lastPassword / setLastPassword 死代码

### Phase 2 — 大文件拆分
- **ffmpeg.ts** (1262行) 拆分为 4 个模块：
  - `ffmpeg-shared.ts` — 二进制解析、取消支持、进度解析、共享接口
  - `ffmpeg-compress.ts` — compressVideo、batchCompress、2-pass 编码
  - `ffmpeg-gif.ts` — convertToGif、batchConvertToGif、双通道调色板
  - `ffmpeg-thumbnails.ts` — captureScreenshot、generateThumbnailSprite、VTT 生成
  - `ffmpeg.ts` 保留核心(分/合/元数据/编码器)并作为 barrel re-exporter
- **PlayerView.vue**: 截图/标记逻辑提取为 `composables/useScreenshot.ts`（零耦合），新增 `ThumbnailData` 类型

### Phase 3 — 类型统一与锁增强
- `VideoMeta` 类型已通过 re-export 模式统一（无需改动）
- `lock.ts` 新增 `LockTimeoutError` 异常、30s 超时自动释放机制
- `main/index.ts` 适配新 acquireLock API（throw 替代 return false）

### 结果
- 全项目零 lint error/warning
- 新增文件：`ffmpeg-shared.ts`, `ffmpeg-compress.ts`, `ffmpeg-gif.ts`, `ffmpeg-thumbnails.ts`, `composables/useScreenshot.ts`
- 修改文件：`ffmpeg.ts`, `lock.ts`, `progress.ts`, `settings.ts`, `file.ts`, `main/index.ts`, `PlaylistPanel.vue`, `Player/types/index.ts`, `package.json`
- **注意**：`crypto.ts` 未做任何修改，保持原始加密逻辑不变
