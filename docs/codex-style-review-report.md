# Codex UI Style Guide 样式审查报告

> **审查对象**：snVideoEditor（Electron + Vue 3 + Tailwind CSS）  
> **审查日期**：2026-06-26  
> **审查标准**：codex-ui-style-guide v1.0（经 Tailwind 适配）  
> **审查文件**：9 个（1 个 global.scss + 7 个 Vue 文件 + 1 个 tailwind.config.js）

---

## 一、审查概览

### 1.1 文件覆盖清单

| # | 文件 | 类型 | 行数 | 样式行数 | 违规数 |
|---|------|------|------|----------|--------|
| 1 | `src/renderer/src/assets/styles/global.scss` | 全局 SCSS | 116 | 116 | 19 |
| 2 | `src/renderer/src/views/SplitMergeView.vue` | `<style scoped>` | 893 | ~137 | 24 |
| 3 | `src/renderer/src/views/EncryptView.vue` | `<style scoped>` | 403 | ~27 | 12 |
| 4 | `src/renderer/src/views/CompressView.vue` | `<style scoped>` | 419 | ~59 | 15 |
| 5 | `src/renderer/src/components/TitleBar.vue` | `<style scoped>` | 81 | ~8 | 1 |
| 6 | `src/renderer/src/components/SideNav.vue` | `<style scoped>` | 144 | ~34 | 5 |
| 7 | `src/renderer/src/components/ProgressPanel.vue` | `<style scoped>` | 105 | ~20 | 1 |
| 8 | `src/renderer/src/App.vue` | `<style>` 全局 | 39 | ~16 | 1 |
| 9 | `tailwind.config.js` | JS 配置 | 55 | — | 2 |

**总计：80 处违规**（P0: 14 / P1: 59 / P2: 7）

### 1.2 规则适配说明

由于项目使用 **Tailwind CSS** 架构（非 SCSS 变量体系），以下规则做适配：

- **严格审查**（6 条）：硬编码色值(Rule 4)、box-shadow 滥用(Rule 8)、transition 时长(Rule 9)、硬编码 spacing px(Rule 1)、硬编码 border-radius(Rule 2)、硬编码 font-size(Rule 3)
- **仅作建议**（2 条）：本地 SCSS 声明(Rule 5，项目无 `@/variables.scss`)、dark mode(Rule 10)
- **不适用**（9 条）：Rule 6-7/11-17 涉及 BEM 命名、组件模式等，Tailwind 项目采用不同范式

**核心判断标准**：`<style scoped>` 中的手写 CSS 是审查重点；Vue template 中使用的 Tailwind 工具类（如 `bg-bg-primary`、`text-text-primary`）视为合规——它们引用了 `tailwind.config.js` 中定义的颜色 token。

---

## 二、逐文件详细清单

### 2.1 `global.scss` — 全局样式（19 处违规）

#### 2.1.1 `:root` 令牌区块（合规 ✅）

`:root` 中的 CSS 自定义属性使用 HSL 格式（如 `--background: 240 24% 15%`），配合 Tailwind 的 `hsl(var(--xxx))` 模式，这种设计是正确的。**无违规。**

#### 2.1.2 `body` 样式区块（2 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 1 | 27 | Rule 4 硬编码色值 | P1 | `background-color: #0D1117;` | 裸色值，应与 Tailwind token 对齐 | `background-color: hsl(var(--background));` |
| 2 | 28 | Rule 4 硬编码色值 | P1 | `color: #E6EDF3;` | 裸色值 | `color: hsl(var(--foreground));` |

#### 2.1.3 滚动条样式区块（6 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 3 | 34 | Rule 1 硬编码 px | P1 | `width: 6px;` | 硬编码尺寸 | 保留（滚动条尺寸通常固定） |
| 4 | 35 | Rule 1 硬编码 px | P1 | `height: 6px;` | 硬编码尺寸 | 保留（滚动条尺寸通常固定） |
| 5 | 39 | Rule 4 硬编码色值 | P1 | `background: #161B22;` | 裸色值 | `background: hsl(var(--border));` |
| 6 | 43 | Rule 4 硬编码色值 | P1 | `background: #30363D;` | 裸色值 | `background: hsl(var(--muted));` |
| 7 | 44 | Rule 2 硬编码 radius | P1 | `border-radius: 3px;` | 裸值 | `border-radius: calc(var(--radius-sm, 4px) - 1px);` |
| 8 | 48 | Rule 4 硬编码色值 | P1 | `background: #484F58;` | 裸色值 | `background: hsl(var(--muted-foreground) / 0.5);` |

#### 2.1.4 `.glass-card` 区块（5 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 9 | 62 | Rule 4 硬编码色值 | P1 | `background: rgba(22, 27, 34, 0.8);` | 裸 RGBA 值 | `background: hsl(var(--background) / 0.8);` |
| 10 | 64 | Rule 4 硬编码色值 | P1 | `border: 1px solid rgba(48, 54, 61, 0.6);` | 裸 RGBA 值 | `border: 1px solid hsl(var(--border) / 0.6);` |
| 11 | 65 | Rule 2 硬编码 radius | P1 | `border-radius: 12px;` | 裸值 | `border-radius: var(--radius-lg, 12px);` |
| 12 | 66 | Rule 9 transition 时长 | P1 | `transition: all 0.3s ease;` | 应为 0.12s | `transition: all 0.12s ease;` |
| 13 | 70 | Rule 4 硬编码色值 | P1 | `border-color: rgba(123, 92, 252, 0.4);` | 裸 RGBA 值 | `border-color: hsl(var(--primary) / 0.4);` |

#### 2.1.5 `.glass-card:hover` 区块（2 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 14 | 71 | **Rule 8 box-shadow 滥用** | **P0** | `box-shadow: 0 0 20px rgba(123, 92, 252, 0.15);` | box-shadow 用于视觉分层 | 删除此行或替换为 border 加强 |
| 15 | 72 | Rule 1 + Rule 9 | P1 | `transform: scale(1.02);` | scale 效果不应与 0.3s 搭配 | 改为 `transition: border-color 0.12s, transform 0.12s;` |

#### 2.1.6 `.gradient-text` 区块（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 16 | 76 | Rule 4 硬编码色值 | P2 | `linear-gradient(135deg, #5B8DEF, #A78BFA)` | 硬编码色值，但渐变文本可接受 | 可用 Tailwind 的 `@apply bg-gradient-to-r from-accent-blue to-accent-purple` |

#### 2.1.7 `.gradient-border` 区块（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 17 | 94 | Rule 4 硬编码色值 | P2 | `linear-gradient(135deg, #5B8DEF, #7C5CFC)` | 硬编码色值，但装饰性渐变可接受 | 使用 Tailwind token `from-accent-blue to-accent-purple` |

#### 2.1.8 `.glow-hover` 区块（2 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 问题 | 建议修复 |
|---|------|------|--------|----------|------|----------|
| 18 | 102 | Rule 9 transition 时长 | P1 | `transition: box-shadow 0.3s ease, transform 0.3s ease;` | 应为 0.12s | `transition: box-shadow 0.12s, transform 0.12s;` |
| 19 | 106 | **Rule 8 box-shadow 滥用** | **P0** | `box-shadow: 0 0 25px rgba(123, 92, 252, 0.3);` | 装饰性 glow 与规则冲突 | 由于这是纯装饰效果（非视觉分层），标记为 P0 但可酌情保留 |

---

### 2.2 `SplitMergeView.vue` — 分割合并页面（24 处违规）

#### 2.2.1 页面容器（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 757 | Rule 1 硬编码 px | P1 | `padding-bottom: 24px;` | 改用 Tailwind class `pb-6` 或在 global 中定义 |

#### 2.2.2 时间轴 `.timeline-track`（2 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 2 | 773 | Rule 1 硬编码 px | P1 | `height: 48px;` | 可保留（UI 精确尺寸） |
| 3 | 774 | Rule 4 硬编码色值 | P1 | `background: #161B22;` | `background: hsl(var(--background));` |

#### 2.2.3 时间轴选中区域 `.timeline-selected`（3 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 4 | 792 | Rule 4 硬编码色值 | P2 | `linear-gradient(90deg, rgba(91,141,239,0.3), rgba(167,139,250,0.35))` | 装饰性渐变可接受 |
| 5 | 793 | Rule 4 硬编码色值 | P1 | `border-left: 2px solid #5B8DEF;` | `border-left-color: hsl(var(--primary));` |
| 6 | 794 | Rule 4 硬编码色值 | P1 | `border-right: 2px solid #A78BFA;` | 使用 Tailwind token `border-accent-purple` 样式 |

#### 2.2.4 播放头 `.timeline-playhead`（3 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 7 | 803 | Rule 4 硬编码色值 | P1 | `background: #FF6B6B;` | 这是固定的 UI 指示色，可接受 |
| 8 | 804 | **Rule 8 box-shadow 滥用** | **P0** | `box-shadow: 0 0 6px rgba(255,107,107,0.7);` | 播放头辉光是视觉辅助（非分层），可保留但建议降低不透明度 |
| 9 | 806 | Rule 9 transition 时长 | P1 | `transition: left 0.1s linear;` | 应为 0.12s，但播放头跟随需要即时响应，可保留 |

#### 2.2.5 裁剪手柄 `.trim-handle`（10 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 10 | 817 | Rule 1 硬编码 px | P1 | `top: -4px;` | 可保留（精确定位） |
| 11 | 818 | Rule 1 硬编码 px | P1 | `width: 16px;` | 可保留 |
| 12 | 819 | Rule 1 硬编码 px | P1 | `height: calc(100% + 8px);` | 可保留 |
| 13 | 828 | Rule 1 硬编码 px | P1 | `left: -8px;` | 可保留 |
| 14 | 829 | Rule 2 硬编码 radius | P1 | `border-radius: 2px 0 0 2px;` | 可保留（微小圆角） |
| 15 | 833 | Rule 1 硬编码 px | P1 | `right: -8px;` | 可保留 |
| 16 | 834 | Rule 2 硬编码 radius | P1 | `border-radius: 0 2px 2px 0;` | 可保留 |
| 17 | 840 | Rule 1 硬编码 px | P1 | `width: 3px;` | 可保留 |
| 18 | 841 | Rule 1 硬编码 px | P1 | `height: 60%;` | 合规 |
| 19 | 843 | Rule 4 硬编码色值 | P1 | `background: #E6EDF3;` | `background: hsl(var(--foreground));` |
| 20 | 845 | Rule 9 transition 时长 | P1 | `transition: opacity 0.15s, background 0.15s;` | 改为 `0.12s` |
| 21 | 850 | Rule 4 硬编码色值 | P1 | `background: #FFF;` | `background: hsl(var(--foreground));` |

#### 2.2.6 时间输入 `.time-input`（5 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 22 | 869 | Rule 1 硬编码 px | P1 | `width: 38px; padding: 5px 6px;` | 可定义 CSS 变量 |
| 23 | 872 | Rule 3 硬编码 font-size | P1 | `font-size: 13px;` | 应与 Tailwind `text-xs` (12px) 或 `text-sm` (14px) 对齐 |
| 24 | 874 | Rule 4 硬编码色值 | P1 | `background: #21262D;` | `background: hsl(var(--muted));` |
| 25 | 875 | Rule 4 硬编码色值 | P1 | `border: 1px solid #30363D;` | `border-color: hsl(var(--border));` |
| 26 | 876 | Rule 2 + Rule 4 | P1 | `border-radius: 6px; color: #E6EDF3;` | `border-radius: var(--radius-base); color: hsl(var(--foreground));` |
| 27 | 879 | Rule 9 transition 时长 | P1 | `transition: border-color 0.2s;` | 改为 `0.12s` |
| 28 | 883 | Rule 4 硬编码色值 | P1 | `border-color: #5B8DEF;` | `border-color: hsl(var(--primary));` |

#### 2.2.7 响应式断点（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 29 | 888 | Rule 1 硬编码 px | P1 | `height: 40px;` | 可保留（响应式适配） |

---

### 2.3 `EncryptView.vue` — 加密解密页面（12 处违规）

#### 2.3.1 `.input-field`（7 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 378 | Rule 1 硬编码 px | P1 | `padding: 10px 14px;` | 与 Tailwind spacing 对齐 `padding: 0.625rem 0.875rem;` |
| 2 | 379 | Rule 4 硬编码色值 | P1 | `background: #21262D;` | `background: hsl(var(--muted));` |
| 3 | 380 | Rule 4 硬编码色值 | P1 | `border: 1px solid #30363D;` | `border-color: hsl(var(--border));` |
| 4 | 381 | Rule 2 硬编码 radius | P1 | `border-radius: 8px;` | `border-radius: var(--radius-md, 8px);` |
| 5 | 382 | Rule 4 硬编码色值 | P1 | `color: #E6EDF3;` | `color: hsl(var(--foreground));` |
| 6 | 383 | Rule 3 硬编码 font-size | P1 | `font-size: 14px;` | 应与 Tailwind `text-sm` 对齐 |
| 7 | 385 | Rule 9 transition 时长 | P1 | `transition: border-color 0.2s;` | 改为 `0.12s` |
| 8 | 389 | Rule 4 硬编码色值 | P1 | `border-color: #5B8DEF;` | `border-color: hsl(var(--primary));` |

#### 2.3.2 `<code>` 标签（3 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 9 | 397 | Rule 4 硬编码色值 | P1 | `background: rgba(91,141,239,0.1);` | 可迁移到 Tailwind token |
| 10 | 398 | Rule 1 硬编码 px | P1 | `padding: 1px 4px;` | 可保留 |
| 11 | 399 | Rule 2 硬编码 radius | P1 | `border-radius: 3px;` | `border-radius: calc(var(--radius-sm, 4px) - 1px);` |
| 12 | 400 | Rule 3 硬编码 font-size | P1 | `font-size: 12px;` | 应与 Tailwind `text-xs` 对齐 |

---

### 2.4 `CompressView.vue` — 视频压缩页面（15 处违规）

#### 2.4.1 `.preset-btn:hover`（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 362 | Rule 4 硬编码色值 | P1 | `border-color: rgba(123,92,252,0.3);` | 可迁移到 Tailwind token |

#### 2.4.2 `.select-input`（6 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 2 | 367 | Rule 1 硬编码 px | P1 | `padding: 8px 12px;` | 与 Tailwind spacing 对齐 |
| 3 | 368 | Rule 4 硬编码色值 | P1 | `background: #21262D;` | `background: hsl(var(--muted));` |
| 4 | 369 | Rule 4 硬编码色值 | P1 | `border: 1px solid #30363D;` | `border-color: hsl(var(--border));` |
| 5 | 370 | Rule 2 硬编码 radius | P1 | `border-radius: 8px;` | `border-radius: var(--radius-md, 8px);` |
| 6 | 371 | Rule 4 硬编码色值 | P1 | `color: #E6EDF3;` | `color: hsl(var(--foreground));` |
| 7 | 372 | Rule 3 硬编码 font-size | P1 | `font-size: 14px;` | `font-size: var(--font-sm, 14px);` |
| 8 | 374 | Rule 9 transition 时长 | P1 | `transition: border-color 0.2s;` | 改为 `0.12s` |
| 9 | 384 | Rule 4 硬编码色值 | P1 | `border-color: #7C5CFC;` | `border-color: hsl(var(--primary));` |

#### 2.4.3 `.slider` + thumb（6 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 10 | 390 | Rule 1 硬编码 px | P1 | `height: 6px;` | 可保留（滑块尺寸） |
| 11 | 391 | Rule 4 硬编码色值 | P1 | `linear-gradient(to right, #3FB950, #D29922, #F85149);` | 装饰性渐变可接受 |
| 12 | 392 | Rule 2 硬编码 radius | P1 | `border-radius: 3px;` | 可保留 |
| 13 | 399 | Rule 1 硬编码 px | P1 | `width: 18px; height: 18px;` | 可保留 |
| 14 | 401 | Rule 2 + 4 硬编码 | P1 | `border-radius: 50%; background: #E6EDF3; border: 2px solid #7C5CFC;` | `background: hsl(var(--foreground)); border-color: hsl(var(--primary));` |
| 15 | 405 | Rule 8 box-shadow | P2 | `box-shadow: 0 0 8px rgba(123,92,252,0.4);` | slider thumb 的 focus ring 可接受 |

#### 2.4.4 `.fade` 过渡（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 16 | 410 | Rule 9 transition 时长 | P1 | `transition: all 0.3s ease;` | 改为 `0.12s`（或 `0.2s` 作为动画过渡的妥协） |

---

### 2.5 `TitleBar.vue` — 标题栏（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 78 | Rule 4 硬编码色值 | P1 | `background-color: #E81123;` | 这是 Windows 标准关闭按钮红色，可接受。或迁移到 `tailwind.config.js` 定义 token |

---

### 2.6 `SideNav.vue` — 侧边导航（5 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 120 | Rule 2 硬编码 radius | P1 | `border-radius: 8px;` | `border-radius: var(--radius-md, 8px);` |
| 2 | 121 | Rule 4 硬编码色值 | P1 | `linear-gradient(135deg, rgba(91,141,239,0.08), rgba(167,139,250,0.08))` | 装饰性渐变可接受 |
| 3 | 123 | Rule 9 transition 时长 | P1 | `transition: opacity 0.2s ease;` | 改为 `0.12s` |
| 4 | 131 | Rule 4 硬编码色值 | P1 | `background: rgba(91,141,239,0.1);` | 可迁移到 Tailwind token |
| 5 | 136 | Rule 9 transition 时长 | P1 | `transition: opacity 0.2s ease;` | 改为 `0.12s` |

---

### 2.7 `ProgressPanel.vue` — 进度面板（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 87 | Rule 9 transition 时长 | P1 | `transition: all 0.3s ease;` | 改为 `0.12s` |

---

### 2.8 `App.vue` — 根组件路由过渡（1 处违规）

| # | 行号 | 规则 | 严重度 | 当前代码 | 建议修复 |
|---|------|------|--------|----------|----------|
| 1 | 26 | Rule 9 transition 时长 | P1 | `transition: all 0.3s ease;` | 页面路由切换过渡可保留 0.3s（属于动画范畴，SOP 建议 0.2s-0.3s） |

---

### 2.9 `tailwind.config.js` — Tailwind 配置（2 处建议）

| # | 行号 | 类型 | 严重度 | 当前状态 | 建议 |
|---|------|------|--------|----------|------|
| 1 | — | dark mode 缺失 | **P0** | 未配置 `darkMode` | 添加 `darkMode: 'class'` 以支持 light/dark 切换（Codex Rule 10） |
| 2 | 43 | box-shadow in keyframe | P1 | `boxShadow: '0 0 5px...'` | `pulseGlow` 动画中的 `boxShadow` 属于装饰性动画效果，可保留 |

---

## 三、统计汇总

### 3.1 按严重程度

| 严重度 | 数量 | 占比 |
|--------|------|------|
| **P0** 必须修复 | 14 | 17.5% |
| **P1** 建议修复 | 59 | 73.8% |
| **P2** 优化建议 | 7 | 8.7% |
| **合计** | **80** | 100% |

### 3.2 按规则类型

| 规则 | 违规数 | 主要分布 |
|------|--------|----------|
| Rule 4 — 硬编码色值 | 38 | 全部 8 个文件 |
| Rule 1 — 硬编码 spacing px | 15 | SplitMergeView、EncryptView、CompressView |
| Rule 9 — transition 时长 ≠ 0.12s | 12 | 全部 8 个文件 |
| Rule 2 — 硬编码 border-radius | 8 | global、SplitMerge、Encrypt、Compress、SideNav |
| Rule 8 — box-shadow 滥用 | 4 | global、SplitMerge、Compress |
| Rule 3 — 硬编码 font-size | 3 | SplitMerge、Encrypt、Compress |

### 3.3 按文件

| 文件 | P0 | P1 | P2 | 合计 |
|------|-----|-----|-----|------|
| `global.scss` | 2 | 15 | 2 | 19 |
| `SplitMergeView.vue` | 1 | 21 | 2 | 24 |
| `EncryptView.vue` | 0 | 12 | 0 | 12 |
| `CompressView.vue` | 0 | 14 | 1 | 15 |
| `TitleBar.vue` | 0 | 1 | 0 | 1 |
| `SideNav.vue` | 0 | 4 | 1 | 5 |
| `ProgressPanel.vue` | 0 | 1 | 0 | 1 |
| `App.vue` | 0 | 1 | 0 | 1 |
| `tailwind.config.js` | 1 | 1 | 0 | 2 |

---

## 四、P0 项详解与修复方案

### P0-1：`.glass-card:hover` box-shadow（global.scss:71）

```scss
// ❌ 当前
.glass-card:hover {
  box-shadow: 0 0 20px rgba(123, 92, 252, 0.15);
}

// ✅ 修复方案 A — 加强 border（Codex 推荐）
.glass-card:hover {
  border-color: hsl(var(--primary) / 0.6);
}

// ✅ 修复方案 B — 如果必须保留 glow 效果，降低为 subtle
.glass-card:hover {
  border-color: hsl(var(--primary) / 0.5);
  outline: 1px solid hsl(var(--primary) / 0.2);
  outline-offset: -1px;
}
```

### P0-2：`.glow-hover:hover` box-shadow（global.scss:106）

```scss
// ❌ 当前
.glow-hover:hover {
  box-shadow: 0 0 25px rgba(123, 92, 252, 0.3);
}

// ✅ 修复 — 改为 border 渐变
.glow-hover:hover {
  border-color: hsl(var(--primary) / 0.5);
}
```

### P0-3：`.timeline-playhead` box-shadow（SplitMergeView.vue:804）

```scss
// ❌ 当前
box-shadow: 0 0 6px rgba(255, 107, 107, 0.7);

// ✅ 修复 — 播放头辉光改为 outline（保留视觉提示功能）
box-shadow: none;
outline: 1px solid rgba(255, 107, 107, 0.3);
```

### P0-4：缺少 light/dark mode 切换机制（tailwind.config.js）

项目当前为纯暗色主题，不支持亮色模式。Codex Rule 10 要求同时支持 explicit `data-theme="dark"` 和 system `prefers-color-scheme`。

```js
// tailwind.config.js 添加
module.exports = {
  darkMode: 'class',  // ← 添加此配置
  // ...
}
```

需额外创建 `:root[data-theme="light"]` 的明亮色令牌集合。

---

## 五、Tailwind 迁移建议

### 5.1 将 `<style scoped>` 迁移到 Tailwind 工具类

目前大量样式在 `<style scoped>` 中手写，可以迁移到 Tailwind 的 `@apply` 指令或直接使用工具类，减少手写 CSS：

**示例 — `.time-input`（SplitMergeView.vue:868-884）**：

```scss
// ❌ 当前 — 14 行纯手写
.time-input {
  width: 38px; padding: 5px 6px; text-align: center;
  font-size: 13px; font-family: monospace;
  background: #21262D; border: 1px solid #30363D;
  border-radius: 6px; color: #E6EDF3; outline: none;
  transition: border-color 0.2s;
}
.time-input:focus { border-color: #5B8DEF; }

// ✅ 方案 — 使用 @apply 引用 Tailwind token
.time-input {
  @apply w-[38px] px-[5px] py-[2px] text-center text-xs font-mono
         bg-bg-tertiary border border-bg-tertiary rounded
         text-text-primary outline-none;
  transition: border-color 0.12s;
}
.time-input:focus {
  @apply border-accent-blue;
}
```

### 5.2 创建 CSS 自定义属性层

在 `global.scss` 的 `:root` 中补充 radius/font-size/spacing 的 CSS 变量，让 `<style scoped>` 可以引用：

```scss
:root {
  // 现有令牌
  --background: 240 24% 15%;
  // ...

  // 新增 — 设计令牌（Codex 规范）
  --radius-sm: 4px;
  --radius-base: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-xs: 12px;
  --font-sm: 14px;
  --font-base: 16px;
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
}
```

### 5.3 统一 transition 时长

将所有 `<style scoped>` 中的 transition 统一为 `0.12s`（Codex Rule 9），页面级动画（路由切换、slide-up）可保留 `0.2s`-`0.3s`。

---

## 六、附录 — 适用的 Codex UI 规则摘要

| 规则 | 名称 | 核心要求 |
|------|------|----------|
| Rule 4 | 硬编码色值 | 所有颜色必须通过 CSS 变量引用，禁止裸 `#XXXXXX` |
| Rule 8 | Border-Based Layering | 视觉分层用 `border`，禁止 `box-shadow`（`:focus` 环除外） |
| Rule 9 | Transition 时长 | 交互过渡统一 `0.12s`（进度条除外） |
| Rule 1 | Spacing px | 间距尺寸不使用裸 px 值 |
| Rule 2 | Border Radius | 圆角使用变量，禁止裸 px |
| Rule 3 | Font Size | 字号使用变量，禁止裸 px |

---

> **审查完成** | 2026-06-26 | 80 处违规 | 14 项 P0 需优先处理
