---
name: fix-packaged-ffprobe-resolution
overview: 修复打包桌面版中 ffprobe/ffmpeg 二进制文件因 asar 打包导致无法执行，进而使 SplitMerge 时间轴滑块无法拖动的 bug。
todos:
  - id: fix-asar-unpack
    content: 在 electron-builder.yml 中添加 asarUnpack 配置，解包 ffprobe-static 和 ffmpeg-static
    status: completed
  - id: fix-external-deps
    content: 在 electron.vite.config.ts 的 main.external 中补充 ffprobe-static
    status: completed
  - id: fix-asar-path
    content: 在 ffmpeg-shared.ts 中添加 unpackAsarPath 工具函数，并在 resolveFfmpegPath 和 resolveFfprobePath 中使用
    status: completed
---

## 问题描述

打包桌面版中，SplitMerge 视图的"裁剪时间轴"中线滑块无法拖动，并提示"无法读取视频信息"。

## 根因

1. `electron-builder.yml` 没有配置 `asarUnpack`，`ffprobe-static` 和 `ffmpeg-static` 的原生二进制（.exe）被打包进 `app.asar` 归档中
2. 原生二进制文件无法从 asar 归档内部执行，`ffmpeg-shared.ts` 中的 `resolveFfprobePath()` 所有 fallback 路径均指向 asar 内部，`canExecute()` 的 `spawnSync` 验证全部失败
3. `getVideoMeta()` 失败 → `duration` 保持为 0 → `startScrub()` 中 `if (duration <= 0) return` 直接返回 → 滑块无法拖动
4. `electron.vite.config.ts` 中 main 的 `external` 列表缺少 `ffprobe-static`

## 修复目标

- 配置 electron-builder 将 `ffprobe-static` 和 `ffmpeg-static` 从 asar 中解包
- 更新二进制路径解析逻辑，打包模式下自动将 `app.asar` 路径替换为 `app.asar.unpacked`
- 补充 electron-vite 的 external 配置

## 技术方案

### 修复策略

两步修复：

1. **构建配置层**：让 electron-builder 将原生二进制解包到 `app.asar.unpacked` 目录，使它们可执行
2. **运行时路径层**：`ffmpeg-shared.ts` 中增加 `unpackAsarPath()` 工具函数，将 asar 内路径自动映射到 unpacked 目录

### 关键设计

#### asarUnpack 配置（electron-builder.yml）

```
asarUnpack:
  - "node_modules/ffprobe-static/**"
  - "node_modules/ffmpeg-static/**"
```

electron-builder 会在打包时将这些目录提取到 `app.asar.unpacked/node_modules/...`，保留 asar 内的原始路径结构供 `require()` 解析。

#### 运行时路径转换（ffmpeg-shared.ts）

新增 `unpackAsarPath(p)` 函数：检测路径是否包含 `app.asar`，若有则替换为 `app.asar.unpacked`。使用 Electron 的 `app.isPackaged` 判断当前环境，避免在开发模式下误替换。

```ts
import { app } from 'electron'

function unpackAsarPath(originalPath: string): string {
  if (!app.isPackaged) { return originalPath }
  const asarIndex = originalPath.indexOf('app.asar')
  if (asarIndex === -1) { return originalPath }
  return originalPath.replace('app.asar', 'app.asar.unpacked')
}
```

在 `resolveFfmpegPath()` 和 `resolveFfprobePath()` 中，对 `require()` 返回的路径和搜索到的路径调用 `unpackAsarPath()` 后再传给 `canExecute()`。

### 影响范围

- 仅改动 `electron-builder.yml`、`electron.vite.config.ts`、`ffmpeg-shared.ts` 三个文件
- 不影响开发模式行为（`app.isPackaged` 为 false 时直接跳过转换）
- 不影响其他视图（Compress、Player、Gif、Encrypt 等同样依赖 `getVideoMeta` 的功能也会受益）