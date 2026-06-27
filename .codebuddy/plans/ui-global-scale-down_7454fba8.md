---
name: ui-global-scale-down
overview: 将项目整体 UI 缩放至更紧凑的比例，使页面功能显示更全面。通过在 html 根元素设置较小的 font-size 作为 rem 基准，全局缩减所有 Tailwind 默认单位的尺寸。
todos:
  - id: global-html-fontsize
    content: "在 global.scss 的 @layer base 中新增 html { font-size: 14px; }"
    status: completed
  - id: sidenav-rem-width
    content: 将 SideNav.vue 中 computed navWidth 从 px 改为 rem（200px→12.5rem, 64px→4rem）
    status: completed
  - id: time-input-rem
    content: 将 SplitMergeView.vue 中 .time-input 的 width 和 font-size 从 px 改为 rem
    status: completed
  - id: input-fontsize-remove
    content: "删除 EncryptView.vue 和 CompressView.vue 中硬编码的 font-size: 14px"
    status: completed
  - id: verify-lint
    content: 验证所有修改文件 lint，确保零新增错误
    status: completed
    dependencies:
      - global-html-fontsize
      - sidenav-rem-width
      - time-input-rem
      - input-fontsize-remove
---

## 用户需求

整体缩小项目 UI，让页面能显示更多功能内容。当前项目没有任何全局缩放机制，所有尺寸基于浏览器默认 16px 基准。

## 核心改动

- 在 `html` 元素上设置 `font-size: 14px`（87.5%），使所有 Tailwind rem 单位自动等比缩小
- 将 4 处不受 rem 影响的硬编码 px 值改为 rem 单位或删除，使其随全局缩放同步缩小

## 技术方案

### 实现策略

利用 TailwindCSS 的 rem 单位特性：所有间距、字号、尺寸都基于 `html` 元素的 `font-size` 计算。当前浏览器默认 `1rem = 16px`，设置 `html { font-size: 14px; }` 后，所有使用 Tailwind class 的元素会自动等比例缩小至 87.5%。

对于少量硬编码 px 值的样式，需手动转换为 rem 单位以跟随全局缩放。

### 修改文件清单

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `global.scss` | 新增 `html { font-size: 14px; }` | 全局缩放基准，所有 rem 自动生效 |
| `SideNav.vue` L37 | `'200px'` → `'12.5rem'`, `'64px'` → `'4rem'` | 导航宽度随缩放缩小 |
| `SplitMergeView.vue` L989-993 | `width: 32px` → `2rem`, `font-size: 11px` → `0.6875rem` | 时间输入框等比缩小 |
| `EncryptView.vue` L387 | 删除 `font-size: 14px` | 自动继承 html 14px 基准 |
| `CompressView.vue` L376 | 删除 `font-size: 14px` | 自动继承 html 14px 基准 |


### 缩放效果预览

- 页面最大宽度 `max-w-6xl`：1152px → 1008px（节省 144px）
- 卡片 padding `p-4`：16px → 14px
- 标题 `text-2xl`：24px → 21px
- 正文 `text-sm`：14px → 12.25px
- SideNav 展开宽度：200px → 175px（节省 25px 给主内容区）
- SideNav 折叠宽度：64px → 56px

总计主内容区宽度增加约 25-40px，整体垂直空间也因间距缩小而容纳更多内容。