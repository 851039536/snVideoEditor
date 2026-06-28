---
name: download-code-dedup
overview: 清理下载模块的代码冗余：删除死代码 fetchPageM3u8、统一 User-Agent 常量、抽取公共 HTTP 工具函数、合并前后端重复的 480p 匹配算法、移除废弃 IPC handler。
todos:
  - id: remove-dead-code
    content: 删除 download.ts 死代码：fetchPageM3u8、extractTitle、extractM3u8Urls、findBestVariant
    status: completed
  - id: extract-ua-constant
    content: 在 download.ts 新增 DEFAULT_UA 常量，替换 download.ts 内两处和 page-fetcher.ts 内一处硬编码 UA
    status: completed
    dependencies:
      - remove-dead-code
  - id: extract-http-helper
    content: 在 download.ts 新增 httpGetText 工具函数，重构 fetchM3u8Variants 使用该函数
    status: completed
    dependencies:
      - remove-dead-code
  - id: merge-page-fetch-result
    content: 删除 page-fetcher.ts 中重复的 PageFetchResult，改为从 download.ts 导入
    status: completed
  - id: remove-dead-handler
    content: 在 index.ts 移除废弃的 video:fetchPageM3u8 handler 和 fetchPageM3u8 导入
    status: completed
    dependencies:
      - remove-dead-code
  - id: cleanup-vue-imports
    content: 删除 DownloadView.vue 中未使用的 ChevronDown 图标导入
    status: completed
---

## 优化目标

清理视频下载模块的代码冗余，在保持功能完全不变的前提下消除死代码、合并共享接口、提取公共常量、简化样板代码。

## 优化项清单

### 1. 删除死代码 (download.ts)

- 删除未被调用的 `fetchPageM3u8()` 函数（line 213-284）—— preload 已将所有页面抓取请求映射到 `fetchPageM3u8ViaBrowser`
- 删除只服务于 `fetchPageM3u8()` 的两个辅助函数：`extractTitle()`（line 289-292）和 `extractM3u8Urls()`（line 298-359）
- 删除未被任何 IPC handler 使用的 `findBestVariant()`（line 512-528）—— 前端已有独立的 `autoSelect480p`

### 2. 删除废弃 IPC Handler (index.ts)

- 移除 `video:fetchPageM3u8` handler（line 260-262）—— 无人调用
- 从 import 中移除 `fetchPageM3u8`（line 7）

### 3. 合并重复接口 (page-fetcher.ts)

- 删除 `page-fetcher.ts` 中重复定义的 `PageFetchResult` 接口（line 3-7）
- 改为从 `download.ts` 导入 `PageFetchResult`

### 4. 提取 User-Agent 常量 (download.ts)

- 新增 `DEFAULT_UA` 常量（值为 Chrome/125 UA 字符串）
- `download.ts` 中的两处和 `page-fetcher.ts` 中的一处硬编码 UA 全部引用该常量
- 前端 `DownloadView.vue` 的 UA_PRESETS 保持不变（属于 UI 层默认值）

### 5. 提取 HTTP 工具函数 (download.ts)

- 抽取 `httpGetText(url, headers?)` 函数封装 URL 解析 → 客户端选择 → 重定向 → Buffer 收集 → 返回文本
- `fetchM3u8Variants` 内部改用此函数

### 6. 清理前端冗余导入 (DownloadView.vue)

- 删除模板中未使用的 `ChevronDown` 图标导入

## 技术方案

### 实现策略

采用"先删后抽"策略：先删除所有死代码以降低耦合面，再抽取共享常量和工具函数。所有改动严格保持功能等价。

### 改动细节

#### download.ts 改动

1. **删除** `fetchPageM3u8()` 函数体（line 213-284）
2. **删除** `extractTitle()` 函数（line 289-292）
3. **删除** `extractM3u8Urls()` 函数（line 298-359）
4. **删除** `findBestVariant()` 函数（line 512-528）
5. **新增** `const DEFAULT_UA = 'Mozilla/5.0 ...'` 在模块顶部（formatHeaders 之后）
6. **新增** 私有函数 `httpGetText(url: string, headers?: Record<string, string>): Promise<string>` 封装：`new URL()` → `https/http` 选择 → 请求构建 → 重定向处理 → `Buffer.concat(chunks).toString('utf-8')`
7. **替换** `fetchM3u8Variants` 中的内联 HTTP 逻辑为调用 `httpGetText`，保留 Edge Case 的 `resolve([])` 静默降级策略
8. 内部两处硬编码 UA 替换为 `DEFAULT_UA` 常量

#### page-fetcher.ts 改动

1. **删除** `PageFetchResult` 接口定义（line 3-7）
2. **新增** `import { PageFetchResult } from './download'`
3. 硬编码 UA（line 138-139）替换为从 `download.ts` 导入的 `DEFAULT_UA`

#### index.ts 改动

1. 第 7 行 import 中移除 `fetchPageM3u8`，保留 `downloadM3u8, fetchM3u8Variants`
2. 删除 `registerDownloadHandlers` 中的 `video:fetchPageM3u8` handler 块（line 260-262）

#### DownloadView.vue 改动

1. 第 3 行 import 中移除未使用的 `ChevronDown` 图标

### 架构优化效果

- `download.ts` 从 ~530 行缩减到 ~350 行
- `page-fetcher.ts` 不再重复定义共享类型
- `index.ts` 移除 1 个废弃 import 和 1 个废弃 handler
- UA 字符串从 6 处硬编码 → 后端 3 处统一为常量 + 前端 3 处保持不变
- HTTP 请求样板代码从 2 份 → 1 份 `httpGetText` 工具函数