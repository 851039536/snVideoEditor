---
name: codex-ui-style-review
overview: 基于 codex-ui-style-guide 技能对 snVideoEditor 项目的所有样式文件进行全面审查，输出违规清单与修复建议报告。
todos:
  - id: review-global-scss
    content: 使用 [skill:codex-ui-style-guide] 审查 global.scss — 逐行检查 :root 令牌、body 样式、滚动条、.glass-card/.gradient-text/.gradient-border/.glow-hover 共 6 个区块，标记硬编码色值/box-shadow/transition 时长违规
    status: completed
  - id: review-split-merge
    content: 使用 [skill:codex-ui-style-guide] 审查 SplitMergeView.vue style scoped — 覆盖时间轴(.timeline-track/.timeline-selected/.timeline-playhead)、裁剪手柄(.trim-handle)、时间输入(.time-input)、响应式断点，标记全部 6 类规则违规
    status: completed
  - id: review-encrypt-compress
    content: 使用 [skill:codex-ui-style-guide] 审查 EncryptView.vue 和 CompressView.vue — 审查 .input-field/code/.select-input/.slider/.preset-btn 的硬编码色值/px/font-size/radius，及 fade transition 时长
    status: completed
  - id: review-components
    content: 使用 [skill:codex-ui-style-guide] 审查 TitleBar/SideNav/ProgressPanel/App.vue — 审查窗口按钮色值、导航项 radius/transition、进度面板 slide-up 过渡、页面切换过渡时长
    status: completed
  - id: review-tailwind-config
    content: 使用 [skill:codex-ui-style-guide] 审查 tailwind.config.js — 检查 colors 色值完整性、animation 时长合理性、keyframes 中 boxShadow 用法、dark mode 配置缺失
    status: completed
  - id: generate-report
    content: 汇总所有违规数据，按 P0/P1/P2 三级分级，生成 docs/codex-style-review-report.md 审查报告（含逐文件清单表格、统计汇总、Tailwind 迁移建议、规则摘要附录）
    status: completed
    dependencies:
      - review-global-scss
      - review-split-merge
      - review-encrypt-compress
      - review-components
      - review-tailwind-config
---

## 用户需求

使用 codex-ui-style-guide 技能，对 snVideoEditor 项目中的全部样式文件进行逐文件、逐规则的规范化审查。

## 审查范围

共 9 个样式相关文件，覆盖全部 `<style>` 块和全局配置：

- `src/renderer/src/assets/styles/global.scss` — 全局样式、`:root` 设计令牌、自定义组件类
- `src/renderer/src/views/SplitMergeView.vue` — 分割合并页面（视频播放器、时间轴、裁剪手柄、时间输入框）
- `src/renderer/src/views/EncryptView.vue` — 视频加密页面（输入框、代码标签）
- `src/renderer/src/views/CompressView.vue` — 视频压缩页面（预设按钮、下拉选择、滑块、过渡动画）
- `src/renderer/src/components/TitleBar.vue` — 标题栏（窗口控制按钮）
- `src/renderer/src/components/SideNav.vue` — 侧边导航（菜单项、折叠动画）
- `src/renderer/src/components/ProgressPanel.vue` — 进度面板（滑入过渡、闪光动画）
- `src/renderer/src/App.vue` — 根组件（页面切换过渡）
- `tailwind.config.js` — Tailwind 配色/动画/关键帧配置

## 产品概述

生成一份结构化的 Markdown 审查报告，包含逐文件违规清单、Codex UI 规则映射、严重程度分级（P0/P1/P2）、以及具体的修复建议代码片段。报告输出到 `docs/codex-style-review-report.md`。

## 核心目标

1. 按 6 条可直接适用的 Codex UI 规则（硬编码色值、硬编码 px/font-size/border-radius、box-shadow 滥用、transition 时长、dark mode 缺失）逐文件审查
2. 区分 Tailwind 项目中适用/不适用的规则，避免机械套用 SCSS 变量规则
3. 提供三级严重程度分级（P0 必须修复 / P1 建议修复 / P2 优化建议）
4. 每条违规附带行号、违规规则编号、当前代码、建议修复代码

## 审查方法论

### 规则映射与适配

由于项目使用 Tailwind CSS 架构（非 SCSS 变量体系），Codex UI Style Guide 的 17 条规则需做适配分类：

**可直接适用规则（6 条，严格审查）**：

| 规则 | 审查要点 | 检查模式 |
| --- | --- | --- |
| Rule 4 — 硬编码色值 | `#XXXXXX` / `rgba()` 裸值需替换为 CSS 变量或 Tailwind token | `#[0-9a-fA-F]{6}\ | #[0-9a-fA-F]{3}` |
| Rule 8 — box-shadow 滥用 | 视觉分层的 `box-shadow` 需改为 `border`；仅 `:focus` 环可保留 | `box-shadow:` 且上下文非 `:focus` |
| Rule 9 — transition 时长 | 非 0.12s 的所有 `transition-duration` 标记为违规 | `transition:.*(?<!0)\.\d+s`（排除 0.12s） |
| Rule 1 — 硬编码 spacing px | `<style scoped>` 中的 `padding/margin/width/height: Npx` | `(padding\ | margin\ | width\ | height):\s*\d+px` |
| Rule 2 — 硬编码 border-radius | `border-radius: Npx` | `border-radius:\s*\d+px` |
| Rule 3 — 硬编码 font-size | `font-size: Npx` | `font-size:\s*\d+px` |


**仅作架构建议规则（2 条，不强制）**：

| 规则 | 说明 |
| --- | --- |
| Rule 5 — 本地 SCSS 声明 | 项目无 `@/variables.scss`，该规则不适用 |
| Rule 10 — dark mode | 项目为纯暗色主题，建议记录为"缺少 light/dark 切换机制"的架构建议 |


**Tailwind 特定适配层**：

- 模板中使用的 Tailwind 工具类（如 `bg-bg-primary`、`text-text-primary`）视为合规，它们引用了 `tailwind.config.js` 中定义的颜色 token
- `<style scoped>` 中的硬编码色值应建议迁移到 `tailwind.config.js` 的 `colors` 扩展中，或使用 `@apply` 引用已有 token

### 严重程度分级标准

| 级别 | 条件 | 典型违规 |
| --- | --- | --- |
| P0 必须修复 | box-shadow 用于视觉分层、广泛硬编码色值破坏主题一致性 | `.glass-card:hover` 的 `box-shadow: 0 0 20px`、`.timeline-playhead` 的辉光 shadow |
| P1 建议修复 | 硬编码 px/font-size/border-radius、transition 非 0.12s | `.time-input` 全套硬编码尺寸、`.input-field` 硬编码 spacing |
| P2 优化建议 | 架构层面改进、SCSS 变量引入建议 | 缺少 `@/variables.scss`、dark mode 切换机制 |


### 输出格式

报告包含 5 个部分：

1. **审查概览** — 文件覆盖清单、违规统计摘要
2. **逐文件详细清单** — 表格格式（行号/规则/严重程度/当前代码/建议修复）
3. **统计汇总** — 按规则维度交叉统计
4. **Tailwind 迁移建议** — 如何将 `<style scoped>` 中的硬编码样式迁移到 Tailwind token
5. **附录** — Codex UI 规则摘要卡

## 使用的技能

### Skill: codex-ui-style-guide

- **用途**: 作为本次审查的规则基准，逐条对照 17 条 Codex UI 样式规范（经 Tailwind 适配后应用 6 条核心规则），对每个样式文件中的每一处 CSS 属性进行规则匹配与违规标记
- **预期产出**: 完整的违规映射表（文件→行号→规则→严重程度→修复建议），覆盖全部 9 个审查文件的预估 55+ 处违规