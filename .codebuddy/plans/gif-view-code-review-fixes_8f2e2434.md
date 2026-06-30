---
name: gif-view-code-review-fixes
overview: 修复 GifConvertView.vue 审查发现的架构违规（缺少 types/index.ts、样式内联过长、硬编码颜色/圆角）和代码质量问题（未使用工具函数、内联 SVG、死 CSS class）。
todos:
  - id: create-types
    content: 创建 views/Gif/types/index.ts，移入 QualityPreset 接口和 WidthOption 类型声明
    status: completed
  - id: extract-scss
    content: 提取 58 行内联样式到 assets/styles/_gif.scss，修复硬编码颜色和 border-radius，组件改用 @use 导入
    status: completed
    dependencies:
      - create-types
  - id: fix-utilities
    content: 使用 hmsToSeconds 和 getFileName 工具函数替换手动实现，用 lucide Play/Pause 图标替换内联 SVG
    status: completed
  - id: fix-template
    content: 修复模板中的 inspect-btn 死 class、硬编码 style 属性和 16:9 宽高比估算
    status: completed
---

## 产品概述

对 `GifConvertView.vue`（视频转 GIF 功能页面）进行代码质量修复和架构规范化，使其符合项目 6 大架构原则和样式分离规则。

## 核心修复内容

- 创建 `views/Gif/types/index.ts` 存放模块私有类型（`QualityPreset` 接口、`WidthOption` 类型）
- 提取 58 行内联样式到 `assets/styles/_gif.scss` SCSS partial 文件
- 修复 4 处硬编码颜色值，改用 CSS 变量 `var(--color-*)`
- 使用项目已有工具函数替换手动实现（`hmsToSeconds`、`getFileName`）
- 用 lucide 图标替代播放按钮的内联 SVG
- 修复 `border-radius: 10px` 硬编码为设计 Token `var(--radius-md)`
- 移除 template 中的硬编码 `style` 属性，改用 Tailwind class
- 修复预设按钮的 `preset-btn` 死 class（无对应样式定义）
- 修复 GIF 大小估算中的硬编码 16:9 宽高比，使用视频实际尺寸

## 技术栈

- Vue 3 Composition API（`<script setup lang="ts">`）
- TypeScript 严格模式
- SCSS partial（`@use` 导入）
- lucide-vue-next 图标库
- TailwindCSS + CSS 变量主题系统

## 实现方案

### 1. 类型提取到 `types/index.ts`

将 `QualityPreset` 接口（L16-20）和 `WIDTH_OPTIONS` 的类型声明移到 `views/Gif/types/index.ts`，组件中通过 `import type` 引用。遵循 `Compress/types/index.ts` 的既有模式。

### 2. 样式提取到 `_gif.scss`

参照 `assets/styles/_compress.scss` 的 partial 模式，将 L625-683 的 58 行 `<style scoped>` 内容全部移到新文件 `assets/styles/_gif.scss`，组件中改为 `@use "../../assets/styles/gif";`。

同时修复样式中的硬编码违规：

- L660 `rgba(240,160,80,0.3)` / `rgba(210,153,34,0.35)` → 使用 `var(--color-warning)` + HSL alpha
- L672 `rgba(255,107,107,0.3)` → 使用 `var(--color-playhead)` + HSL alpha  
- L633 `rgba(240,160,80,0.4)` → 使用 `var(--color-warning)` + HSL alpha
- L642 `border-radius: 10px` → `var(--radius-md, 8px)`

### 3. 使用项目工具函数

- L48-49 `hmsFieldSetter` 中 `parseInt(h)*3600 + parseInt(m)*60 + parseInt(s)` → 改为 `hmsToSeconds(h, m, s)`（需新增 import）
- L392 `files[0].path.split(/[/\\]/).pop()` → 改为 `getFileName(files[0].path)`
- L487 `entry.path.split(/[/\\]/).pop()` → 改为 `getFileName(entry.path)`

### 4. lucide 图标替换内联 SVG

导入 `Play`, `Pause` 图标，L379-385 的内联 SVG 替换为：

```html
<Pause v-if="isPlaying" :size="14" class="text-white" />
<Play v-else :size="14" class="text-white ml-0.5" />
```

### 5. 模板修复

- L525 `style="border-width: 1px; border-style: solid;"` → 添加 Tailwind `border` class
- L521 `preset-btn` → 改为 `quality-preset-btn`，在 `_gif.scss` 中定义（或直接用 Tailwind utility）
- L251 `w * 9 / 16` 硬编码宽高比 → 使用 `entry.meta.height` 计算实际比例

### 6. 宽高比修复逻辑

当视频 meta 有宽高信息时，使用 `entry.meta.width / entry.meta.height` 计算实际比例；无 meta 时回退到 16:9。

## 注意事项

- `@use` 必须放在 `<style scoped>` 块的第一行
- 所有修改保持向后兼容，不改变现有功能行为
- `--color-playhead` 变量已在 `global.scss` 中定义（深色 #FF6B6B / 浅色 #CF222E），无需新增
- 涉及的 CSS 变量转换：`rgba(R,G,B,A)` → `hsl(var(--color-xxx) / A%)` 形式

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：验证 `assets/styles/global.scss` 中 CSS 变量（`--color-warning`、`--color-playhead`、`--color-accent-light`）的具体 HSL 值，确保 SCSS partial 中颜色转换准确
- 预期结果：获取各变量的 HSL 定义，保证 rgba→hsl 转换无误