---
name: auto-headers-no-ui
overview: 隐藏 HTTP 请求头编辑界面，改为从页面解析时自动配置 Referer/Origin/Cookie/User-Agent，用户无需手动管理。
todos:
  - id: replace-headers-reactive
    content: 在 script 中：增加 reactive 导入、移除 useHeaders/Plus/Trash2 导入、用 reactive 对象替代 useHeaders、简化 syncCookiesForUrl 和 auto-fill 逻辑、修改 enqueueDownload 传参
    status: completed
  - id: remove-headers-card
    content: 在 template 中删除"HTTP 请求头"卡片（第 551-584 行）
    status: completed
---

## 用户需求

隐藏下载页面中的"HTTP 请求头"编辑面板，所有请求头（Referer、Cookie、User-Agent、Origin）改为后台自动配置，用户无需手动管理。

## 核心功能

- 移除"HTTP 请求头"可编辑卡片及其所有 UI（header 键值对输入框、添加/删除按钮、UA 快捷填充）
- 默认自动设置 Chrome User-Agent
- 点击"从网页提取"后自动设置 Referer 和 Origin（基于页面 URL）
- 选择 m3u8 地址后自动按域名过滤并填充 Cookie
- 下载时自动携带所有后台管理的 headers

## 技术方案

### 实现策略

将 `useHeaders()` composable（基于 `HeaderEntry[]` 数组）替换为简单的 `reactive<Record<string, string>>` 对象，所有 header 操作改为直接读写该对象。仅修改一个文件。

### 修改详情

**文件**：`src/renderer/src/views/Download/DownloadView.vue`

#### Script 修改

1. **Vue 导入**：第 2 行 `import { ref, computed, onMounted, onUnmounted, watch } from 'vue'` 增加 `reactive`

2. **图标导入清理**：第 3 行移除 `Plus` 和 `Trash2`（仅用于 headers 卡片）

3. **移除 useHeaders 导入**：删除第 7 行 `import { useHeaders } from '@/composables/useHeaders'`

4. **替换 headers 声明**（第 158 行）：

```ts
// 旧：const { headers, UA_PRESETS, addHeader, removeHeader, applyUAPreset, buildHeaders } = useHeaders()
// 新：
const headers = reactive<Record<string, string>>({
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
})
```

5. **简化 syncCookiesForUrl**（第 67-75 行）：去掉 `find` 查找 HeaderEntry，直接操作 `Record`：

```ts
function syncCookiesForUrl(url: string): void {
const cookieStr = buildCookiesForUrl(url)
if (cookieStr) { headers['Cookie'] = cookieStr }
else { delete headers['Cookie'] }
}
```

6. **简化 fetchM3u8FromPage 中的 auto-fill**（第 312-320 行）：同样去掉 HeaderEntry 查找，直接写 `headers['Referer']` 和 `headers['Origin']`

7. **修改 enqueueDownload**（第 371 行）：`buildHeaders()` 改为直接传 `{ ...headers }`

#### Template 修改

删除第 551-584 行整个 "HTTP 请求头" 卡片块（`<div class="glass-card p-4">` 含其全部子元素）。

### 数据流（不变）

```
页面解析 → fetchM3u8FromPage → headers['Referer'] = origin + '/'
                               → headers['Origin'] = origin
选择m3u8 → selectFetchedUrl → syncCookiesForUrl → headers['Cookie'] = domainFiltered
开始下载 → enqueueDownload → { ...headers } → buildHeaders → IPC → chromiumFetch
```