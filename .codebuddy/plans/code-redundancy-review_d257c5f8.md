---
name: code-redundancy-review
overview: 对 snVideoEditor 项目进行全面的代码冗余审查，分类整理出可优化的问题点并给出改进建议。
todos:
  - id: clean-duplicate-file
    content: 删除 src/renderer/src/lib/time.ts，将 SplitMergeView 和 ClipList 的导入路径统一改为 @/utils/time
    status: completed
  - id: extract-format-utils
    content: 新建 src/renderer/src/utils/format.ts，抽取 formatSize 和 getFileName 函数；修改 CompressView、EncryptView、VideoPreview 使用统一导入，删除各自内联实现
    status: completed
  - id: unify-inline-utils
    content: 消除视图层内联重复：EncryptView 的 secondsToHMS 改用 @/utils/time；SplitMergeView 的 hmsToSeconds 和 clamp 改用 @/utils/time 和 @/utils/math
    status: completed
    dependencies:
      - clean-duplicate-file
      - extract-format-utils
  - id: unify-types
    content: 统一重复类型定义：ClipItem 接口移到 types/file.ts；VideoMeta 统一从 preload/index.d.ts 导入，删除 SplitMergeView 和 EncryptView 内的重复定义
    status: completed
  - id: abstract-ipc-handler
    content: 在 src/main/index.ts 中抽取 wrapOperation 高阶函数，将 10 处重复的 acquireLock/try-finally/releaseLock/sendProgress 模式重构为一行调用
    status: completed
  - id: clean-dead-code
    content: 清理死代码：移除 FileDropZone.vue 中未使用的 isProcessing、VideoPreview.vue 中未使用的 isDetailOpen、global.scss 中未使用的 .gradient-border 和 .file-item
    status: completed
  - id: verify-imports
    content: 使用 [subagent:code-explorer] 全局搜索验证无残留引用，确认所有导入路径正确
    status: completed
    dependencies:
      - clean-duplicate-file
      - extract-format-utils
      - unify-inline-utils
      - unify-types
      - abstract-ipc-handler
      - clean-dead-code
---

## 产品概述

对 SN Video Editor 项目进行全面的代码冗余审查与清理，消除项目中存在的重复函数、重复类型定义、copy-paste 模式、死代码和无用文件。

## 核心清理目标

### 1. 消除重复工具文件

删除 `src/renderer/src/lib/time.ts`，该文件与 `src/renderer/src/utils/time.ts` 完全重复，仅含一个 `secondsToHMS` 函数。统一所有导入路径到 `@/utils/time`。

### 2. 统一内联工具函数到 utils/

将视图层中多处重复内联的工具函数统一抽取到 `utils/` 目录：

- `formatSize`：CompressView、EncryptView、VideoPreview 中各有相同实现
- `secondsToHMS`：EncryptView 中重复内联
- `hmsToSeconds`：SplitMergeView 中重复内联（utils/time.ts 已有）
- `clamp`：SplitMergeView 中重复内联（utils/math.ts 已有）
- `getFileName`：SplitMergeView 和 EncryptView 中各有一份

### 3. 统一重复的类型定义

- `VideoMeta` 接口在 5 处重复定义（main/ffmpeg.ts、preload/index.ts、preload/index.d.ts、SplitMergeView.vue、EncryptView.vue），统一从 preload/index.d.ts 导出并全局复用
- `ClipItem` 接口在 SplitMergeView.vue 和 ClipList.vue 中重复定义，统一到 types/ 目录

### 4. 抽象 IPC Handler 注册函数

将主进程 index.ts 中约 10 次重复的 acquireLock/try-finally/releaseLock/sendProgress 模式抽取为通用 `wrapOperation` 高阶函数。

### 5. 抽取 Timeline 通用组件

将 SplitMergeView 和 GifConvertView 中高度重复的 timeline 拖拽交互逻辑（播放头、模糊区域、手柄拖拽）抽取为通用 `TimelineBar.vue` 组件。

### 6. 清理死代码

移除 FileDropZone.vue 中未使用的 `isProcessing` ref、VideoPreview.vue 中未使用的 `isDetailOpen`、global.scss 中未使用的 `.gradient-border` 和 `.file-item` CSS 类。

## 技术方案

### 实现策略

采用**渐进式清理**策略，按影响范围从小到大逐步消除冗余，每步均可独立验证，避免大规模重构带来的风险。

### 关键决策

1. **删除 lib/time.ts**：只有一个函数且与 utils/time.ts 完全重复，直接删除并统一导入路径（影响 2 个文件）
2. **工具函数统一到 utils/**：新增 `utils/format.ts` 存放格式化类函数（formatSize、getFileName），避免 utils/ 目录膨胀
3. **类型定义收敛到 preload**：VideoMeta 等跨进程共用的类型应以 preload/index.d.ts 为权威来源，因为它是类型声明的天然边界
4. **IPC handler 抽象**：用高阶函数 `wrapOperation` 封装 lock + progress + finally 模式，减少约 150 行重复代码
5. **Timeline 组件抽取**：抽取为新通用组件，SplitMergeView 和 GifConvertView 通过 props 定制差异行为
6. **死代码清理**：仅移除确认无引用的代码，保持谨慎

### 实现注意事项

- **性能**：工具函数抽取为纯函数，无额外开销；Timeline 组件化后由 Vue 编译优化，渲染性能不变
- **日志**：无需新增日志，现有错误处理保持原样
- **兼容性**：所有修改保持 API 签名不变，视图层行为完全一致；仅重组代码结构
- **blast radius**：修改集中在 renderer 端，main 进程仅重构 IPC handler 注册方式，不影响预加载 API 契约
- **分批验证**：每完成一类冗余清理即可独立验证编译和功能正确性

### 目录结构变更

```
src/renderer/src/
├── lib/
│   └── time.ts              # [DELETE] 与 utils/time.ts 重复，删除
├── types/
│   └── file.ts              # [MODIFY] 新增 ClipItem 等共享类型
├── utils/
│   ├── time.ts              # [MODIFY] 补全 formatDuration 等统一导出
│   ├── math.ts              # 不变
│   └── format.ts            # [NEW] 抽取 formatSize、getFileName 等格式化函数
├── components/
│   ├── TimelineBar.vue      # [NEW] 通用时间轴拖拽组件，含拖拽手柄/播放头/模糊区域交互
│   ├── FileDropZone.vue     # [MODIFY] 移除未使用的 isProcessing ref
│   ├── VideoPreview.vue     # [MODIFY] 移除未使用的 isDetailOpen，改用 utils/format
│   └── (其余不变)
├── composables/
│   └── useOperation.ts      # [NEW] 抽取 store.start + onProgress + try-catch 通用模式
├── views/
│   ├── SplitMerge/
│   │   ├── SplitMergeView.vue  # [MODIFY] 导入统一类型和工具函数，使用 TimelineBar
│   │   └── ClipList.vue        # [MODIFY] 导入统一 ClipItem 类型
│   ├── Compress/
│   │   └── CompressView.vue    # [MODIFY] 使用 utils/format、useOperation
│   ├── Encrypt/
│   │   └── EncryptView.vue     # [MODIFY] 使用 utils/format、utils/time，移除内联函数
│   └── Gif/
│       └── GifConvertView.vue  # [MODIFY] 使用 TimelineBar，移除内联 timeline 代码
├── assets/styles/
│   └── global.scss             # [MODIFY] 移除 .gradient-border、.file-item 死样式
│
src/main/
└── index.ts                    # [MODIFY] 用 wrapOperation 高阶函数替换重复 IPC handler 模式
```

## Agent Extensions

### SubAgent

- **code-explorer**
- 用途：在修改完成后验证所有导入路径正确性，确认无遗漏引用
- 预期结果：确认删除 lib/time.ts 后无残留导入，确认类型导入路径全部更新正确