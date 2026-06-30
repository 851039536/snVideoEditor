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
