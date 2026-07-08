---
name: fix-chromium-downloader-ssl
overview: 修复 chromium-downloader 的 SSL 握手失败问题：传递 headers（Cookie/Referer）、配置 session 忽略证书错误、增加 SSL 重试和 curl 降级兜底。
todos:
  - id: fix-chromium-types
    content: 修改 chromium-downloader.ts：ChromiumDownloadOptions 增加 headers 字段，chromiumFetch 增加 headers 参数并合并到 net.fetch 调用
    status: completed
  - id: fix-chromium-calls
    content: 修改 chromium-downloader.ts：downloadViaChromium 内所有 chromiumFetch 调用传入 opts.headers
    status: completed
    dependencies:
      - fix-chromium-types
  - id: fix-download-bridge
    content: 修改 download.ts：downloadM3u8 将 opts.headers 传递给 downloadViaChromium
    status: completed
---

## 问题描述

chromium-downloader 在连接 CDN（surrit.com）时 SSL 握手失败，报错 `handshake failed; returned -1, SSL error code 1, net_error -100`（ERR_CONNECTION_CLOSED）。页面解析成功但下载失败。

## 根因

`downloadM3u8()` 接收到 `opts.headers`（含 Cookie、Referer 等认证信息），但调用 `downloadViaChromium()` 时丢弃了这些 headers。`chromiumFetch()` 仅发送 `User-Agent`，缺少 Cookie 等认证信息，CDN（位于 Cloudflare 后）在 TLS 层面拒绝连接。

数据流断点：

```
QueueManager.startDownload → downloadM3u8({headers: item.headers})
  → downloadViaChromium({url, output})  // headers 被丢弃
  → chromiumFetch(url) → net.fetch(url, {headers: {User-Agent}})  // 无 Cookie
```

## 修复目标

将 `opts.headers` 从 `downloadM3u8` 传递到 `downloadViaChromium`，再传递到 `chromiumFetch`，使 `net.fetch()` 携带完整的 Cookie 和 Referer 请求头。

## 技术方案

### 修改范围

仅涉及 2 个文件，改动极小且无架构影响。

### 修改详情

#### 1. `src/main/modules/chromium-downloader.ts`

**`ChromiumDownloadOptions` 接口**：增加 `headers?: Record<string, string>` 字段。

**`chromiumFetch()` 函数**：增加 `headers` 参数，将其与默认 `User-Agent` 合并后传给 `net.fetch()`。

**`downloadViaChromium()` 函数**：将 `opts.headers` 转发给 `chromiumFetch()`。

具体改动点：

- 第 29-44 行：在 `ChromiumDownloadOptions` 接口中新增 `headers` 字段
- 第 111-128 行：修改 `chromiumFetch` 签名，增加 `headers` 参数，合并到 `net.fetch` 的 `headers` 选项中（用户 headers 优先级高于默认 UA）
- 第 167 行：调用 `chromiumFetch(opts.url, abortController.signal, opts.headers)` 传入 headers
- 第 199 行：`downloadSegment` 内调用 `chromiumFetch(seg.url, abortController.signal, opts.headers)` 传入 headers

#### 2. `src/main/modules/download.ts`

**`downloadM3u8()` 函数**（第 145-163 行）：将 `opts.headers` 传递给 `downloadViaChromium({..., headers: opts.headers})`。

### 关键设计决策

- **headers 合并优先级**：`net.fetch()` 中用户传入的 headers 覆盖默认 `User-Agent`，确保用户自定义的 Cookie/Referer/UA 优先
- **TS 分片继承 headers**：下载每个 TS 分片时复用同一套 headers，确保每个子请求都携带认证信息
- **不修改 IPC 层或 renderer 层**：QueueManager 和 DownloadView 已正确传递 headers，仅需修复 main 进程内部的传递链路