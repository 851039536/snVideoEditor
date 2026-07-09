---
name: sidenav-redundancy-and-expand
overview: 审查 SideNav.vue 冗余问题并优化：创建 config/features.ts 作为单一数据源消除 SideNav/HomeView 间的重复数据；为侧边栏新增收起状态持久化 + 鼠标悬停自动展开功能。
todos:
  - id: create-features-config
    content: 新建 src/renderer/src/config/features.ts，定义 FeatureMeta 接口和 FEATURE_CONFIG 常量数组，统一管理所有功能元数据（name/path/icon/color/desc/gradient）
    status: completed
  - id: extend-settings-store
    content: 扩展 src/renderer/src/stores/settings.ts，新增 sidebarCollapsed 状态、toggleSidebar 方法和 localStorage 持久化
    status: completed
  - id: refactor-sidenav
    content: 重构 src/renderer/src/components/SideNav.vue：从 features.ts 派生导航项、改用 settingsStore 管理折叠状态、实现 hover 临时展开效果
    status: completed
    dependencies:
      - create-features-config
      - extend-settings-store
  - id: refactor-homeview
    content: 重构 src/renderer/src/views/Home/HomeView.vue：从 features.ts 派生功能卡片，消除本地硬编码重复，统一图标
    status: completed
    dependencies:
      - create-features-config
---

## 用户需求

### 冗余审查

SideNav.vue 与 HomeView.vue 各自维护独立的功能列表数据，存在高度重复：

- SideNav 硬编码 `navItems`（name/path/icon/color）
- HomeView 硬编码 `cards`（title/desc/path/icon/gradient）
- CODEBUDDY.md 约定 `config/features.ts` 作为功能元数据单一数据源，但该文件从未创建

按项目架构要求，新建 `config/features.ts` 统一管理所有功能元数据，SideNav 和 HomeView 均从此派生，消除两处硬编码重复，同时统一"播放器"图标不一致问题（HomeView 用 Play，SideNav 用 Video）。

### 展开缩放增强

目前 SideNav 已有基础的展开/收起功能（本地 ref + 按钮切换），但存在两个缺陷：

1. **收起状态未持久化**：刷新页面后 sidebar 总是回到展开状态
2. **无 hover 展开**：收起后需要手动点击按钮才能展开查看导航项

增强后：

- 收起状态通过 settingsStore 持久化到 localStorage，刷新后保持
- 收起状态下鼠标悬停侧边栏时自动临时展开（覆盖显示的宽度），移出后自动收回

## 技术方案

### 技术栈

- Vue 3 + TypeScript + Composition API
- Pinia（状态持久化）
- TailwindCSS + CSS 变量（样式）
- lucide-vue-next（图标）

### 实现方案

#### 1. 创建 config/features.ts（单一数据源）

定义 `FeatureMeta` 接口，包含 name、path、icon、color、desc、gradient 等字段。导出一个 `FEATURE_CONFIG` 常量数组，汇集所有功能模块的元数据。

**设计要点**：

- 图标统一引用 lucide-vue-next 组件类型（`typeof Home`），保证类型安全
- icon 字段同时服务 SideNav（导航项）和 HomeView（卡片），统一不一致项（播放器统一用 `Video` 图标）
- color/desc/gradient 字段根据使用场景按需取用，各组件自行映射

#### 2. 重构 SideNav.vue

- 删除本地 `NavItem` 接口和 `navItems` 硬编码数组
- 从 `config/features.ts` 导入 `FEATURE_CONFIG`，静态映射为导航项列表
- 删除本地 `collapsed` ref，改用 settingsStore 的 `sidebarCollapsed`
- 新增 `hoverExpanded` ref，实现 hover 展开逻辑：
- 鼠标进入侧边栏时，若当前为收起态则 `hoverExpanded = true`
- 实际渲染宽度 = `hoverExpanded || !sidebarCollapsed` 时使用展开宽度，否则使用收起宽度
- 鼠标离开侧边栏时，`hoverExpanded = false`
- 删除本地 `toggleCollapsed`，改用 `settingsStore.toggleSidebar()`

#### 3. 扩展 settingsStore

- 新增 `sidebarCollapsed` 状态字段
- 新增 `toggleSidebar()` 方法
- 新增 localStorage 读写逻辑（key: `snve-sidebar-collapsed`），与 theme 持久化模式一致
- 初始化时从 localStorage 读取，默认值为 `false`（展开）

#### 4. 重构 HomeView.vue

- 删除本地 `FeatureCard` 接口和 `cards` 硬编码数组
- 从 `config/features.ts` 导入 `FEATURE_CONFIG`
- 过滤掉首页自身（path 为 `/` 的条目），静态映射为卡片列表

### 性能考虑

- `FEATURE_CONFIG` 在模块顶层定义为常量，只需一次解析，零运行时开销
- hover 展开使用 CSS transition + ref 切换，避免不必要的重渲染
- 宽度计算使用 computed，仅在依赖变化时重新求值

### 代码设计

- 遵循 CODEBUDDY.md 6 大原则：功能模块化、注册完整性、类型安全单一数据源、统一入口、设计 Token、样式分离
- 样式使用 Tailwind utility class 和 CSS 变量，禁止硬编码颜色
- 内部 `<style scoped>` 不超过 10 行，遵循样式分离规则