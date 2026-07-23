---
name: fix-sass-and-page-fetcher-errors
overview: 修复 Sass Legacy JS API 弃用警告、page-fetcher 的 did-fail-load 过于激进 reject、以及 SSL 相关错误处理
todos:
  - id: fix-sass-api
    content: "在 electron.vite.config.ts 的 scss preprocessorOptions 中添加 api: 'modern' 消除 Sass Legacy JS API 警告"
    status: completed
  - id: fix-page-fetcher
    content: 修复 page-fetcher.ts 中 did-fail-load 处理器，使用 isMainFrame 参数区分主页面失败和子资源失败，避免 ERR_ABORTED 误判
    status: completed
---

## 需求概述

修复当前控制台中出现的三类错误/警告，提升开发体验和模块健壮性。

## 修复内容

### 修复1：消除 Sass Legacy JS API 弃用警告

当前所有 `.vue` 文件中使用 `@use` 导入 SCSS partial 时，Vite 默认使用 Sass 的 Legacy JS API，导致控制台大量输出 `Deprecation [legacy-js-api]` 警告。需在 Vite 构建配置中显式启用现代 API。

### 修复2：修复 M3U8 页面抓取的 did-fail-load 误判

`page-fetcher.ts` 中 `did-fail-load` 事件处理器将子帧/子资源加载失败（如 ERR_ABORTED -3）也当作主页面失败进行 reject，导致正常抓取流程被中断。需改用 `isMainFrame` 参数精准过滤，仅对主页面导航失败进行 reject。

### 修复3：减少 SSL 握手失败级联错误

SSL 握手失败（`net_error -100`）是目标网站的网络问题，无法在应用层消除，但通过修复 did-fail-load 误判可避免由此引发的级联 IPC 错误输出。

## 技术方案

### 修改1：electron.vite.config.ts — 启用 Sass Modern API

**策略**：在 `css.preprocessorOptions.scss` 中添加 `api: 'modern'`。项目使用 `sass-embedded@^1.100.0`，完全支持现代 API，无需升级依赖。

**改动点**：

```ts
scss: {
  api: 'modern',
  additionalData: ''
}
```

Vite 5 支持 `api: 'modern'` 选项，会使用 Sass 的 modern compile API 替代已弃用的 legacy JS API，消除警告且性能更优。

### 修改2：src/main/modules/page-fetcher.ts — 修复 did-fail-load 逻辑

**策略**：利用 Electron `did-fail-load` 事件的 `isMainFrame` 参数（第5个参数，Electron 12+ 可用，项目使用 Electron 31）区分主页面失败和子资源失败。

**关键改动**：

`did-fail-load` 处理器（第126-135行）当前逻辑：

```ts
// 旧逻辑：任何非 favicon 的负错误码都 reject
if (errorCode < 0 && !validatedURL.includes('favicon')) {
  resolved = true
  clearTimeout(timer)
  cleanup()
  reject(...)
}
```

改为：

```ts
// 新逻辑：仅主页面失败才 reject，忽略子帧/子资源失败
if (isMainFrame && errorCode < 0) {
  resolved = true
  clearTimeout(timer)
  cleanup()
  reject(new Error(`页面加载失败: ${errorDescription} (错误码: ${errorCode})`))
}
```

**设计决策分析**：

- `isMainFrame` 比 `validatedURL === pageUrl` 更可靠，因为页面可能发生重定向导致 URL 不一致
- 子资源失败（如 `did-fail-load` 中的 ERR_ABORTED on subframes）是正常现象，网页中经常有被取消的 iframe/ad 请求，不应影响主流程
- `did-finish-load`（主页面成功）和 `did-fail-load`（子资源失败）可共存，现有 `resolved` 守卫已能正确处理：子资源失败被忽略后，主流程继续等待 `did-finish-load` 或超时
- `loadURL.catch` 和 `did-fail-load`（主页面）可能同时触发，但 `resolved` 守卫确保只有一个生效，无需额外协调
- SSL 握手失败（`net_error -100`）时，主页面 `loadURL` 会 reject → `loadURL.catch` 处理，同时 `did-fail-load(isMainFrame=true)` 也会触发。两者竞争时 `resolved` 守卫保证只 reject 一次

## 影响范围

- `electron.vite.config.ts`：仅构建配置，不影响运行时行为
- `src/main/modules/page-fetcher.ts`：修复 `did-fail-load` 处理器，不影响其他事件处理器和主流程
- 不涉及新增文件、不改变 IPC 协议、不改变 preload API