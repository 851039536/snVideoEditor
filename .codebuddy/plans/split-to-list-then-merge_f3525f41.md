---
name: split-to-list-then-merge
overview: 重构视频裁剪/合并工作流：裁剪分段→加入剪辑列表→勾选合并。涉及 SplitMergeView.vue 重写、preload 新增 getTempDir API、主进程 IPC 对应实现。
todos:
  - id: add-tempdir-ipc
    content: 主进程新增 app:getTempDir IPC，预加载新增 getTempDir API 及类型声明
    status: completed
  - id: refactor-split-view
    content: 裁剪模式：新增 ClipItem 接口 + clips 状态 + "裁切到列表"按钮 + 片段列表面板
    status: completed
    dependencies:
      - add-tempdir-ipc
  - id: refactor-merge-view
    content: 合并模式：展示 clips 勾选列表 + 外部文件拖放 + 排序移除 + "合并选中"按钮
    status: completed
    dependencies:
      - refactor-split-view
---

## 用户需求

将「裁剪→直接导出」的单步流程改为「裁剪→加入列表→批量选择→统一合并」的多步工作流。

## 产品概述

用户加载一个视频后，在时间轴上选取多个片段，每个片段通过 ffmpeg 无损裁剪（-c copy）到临时目录，并加入片段列表。裁剪完成后切换到合并模式，从列表中勾选要合并的片段（可调顺序、可移除），最后一键合并输出。

## 核心功能

- **裁剪加入列表**：时间轴选中片段后点击"裁切到列表"，ffmpeg 用 -c copy 无损提取到临时目录，片段信息加入 clips 列表
- **片段列表展示**：裁剪模式下实时显示已添加的片段（来源文件、时间范围、时长），支持移除
- **多选合并**：合并模式下展示 clips 列表 + 外部视频文件，可勾选、排序、移除，一键合并选中项
- **临时目录管理**：主进程返回系统临时目录下的专用子目录，所有中间片段文件存放在此

## 技术选型

- 前端框架：Vue 3 + TypeScript（复用现有）
- 视频处理：fluent-ffmpeg（复用现有 splitVideo / mergeVideos）
- IPC 通信：Electron ipcMain.handle + contextBridge（复用现有模式）

## 实现方案

### 架构设计

```
┌─ 裁剪模式 ──────────────────────────────────────┐
│  [视频播放器]  [时间轴+拖拽把手]  [精确输入]     │
│  [裁切到列表 ▼]                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 片段列表                                     │ │
│  │ #1 source.mp4  00:00~00:30  30s  [× 移除]   │ │
│  │ #2 source.mp4  01:15~02:00  45s  [× 移除]   │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
           │  切换到合并 Tab
           ▼
┌─ 合并模式 ──────────────────────────────────────┐
│  ┌─ 片段列表（裁剪产出）────────────────────────┐ │
│  │ ☑ #1 source.mp4  00:00~00:30   [↕] [×]     │ │
│  │ ☑ #2 source.mp4  01:15~02:00   [↕] [×]     │ │
│  │ ☐ #3 source.mp4  03:00~04:00   [↕] [×]     │ │
│  └──────────────────────────────────────────────┘ │
│  ┌─ 外部文件 ──────────────────────────────────┐ │
│  │ [拖放区域]  +  已添加: other.mp4  [×]       │ │
│  └──────────────────────────────────────────────┘ │
│  [选择输出位置]        [▶ 合并选中 (3个片段)]     │
└──────────────────────────────────────────────────┘
```

### 数据流

```
用户拖拽时间轴 → trimStartSec/trimEndSec 更新
  → 点击"裁切到列表"
    → 构造 outputFile = tempDir/clip_<timestamp>_<idx>.mp4
    → IPC video:split({input, output, startTime, duration})
    → ffmpeg -ss -t -c copy
    → 成功后 clips.push({...})
    → 列表 UI 自动更新

切换到合并模式 → 展示 clips 列表 + 外部文件列表
  → 用户勾选/排序/移除
  → 点击"合并选中"
    → 收集 checkedClips + externalFiles → inputs[]
    → IPC video:merge({inputs, output})
    → ffmpeg concat demuxer
```

### 关键接口

```ts
// ClipItem 类型
interface ClipItem {
  id: string
  sourceFile: string
  sourceFileName: string
  startSec: number
  endSec: number
  duration: number
  outputFile: string
  selected: boolean
}

// 新增 IPC
'app:getTempDir' → string  // 返回 app.getPath('temp')/sn-video-clips
```

## 实现细节

### 性能优化

- splitVideo 使用 `-c copy`（无损流拷贝），无需重新编码，速度接近文件拷贝
- 临时目录使用系统 temp 路径，不占用用户工作目录空间
- clips 数组使用 v-for key 绑定 id，避免重渲染

### 边界处理

- clipDurationSec <= 0 时禁用裁切按钮
- 列出至少 2 个选中项才允许合并
- 裁剪失败时弹出错误提示，不加入列表
- 合并前确保所有输入文件存在

### 日志/错误

- 复用现有 errorMsg ref 显示错误
- splitVideo 内部已有 reject(new Error(...)) 错误处理