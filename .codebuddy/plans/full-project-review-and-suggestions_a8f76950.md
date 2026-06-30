---
name: full-project-review-and-suggestions
overview: 对 SN Video Editor Electron 项目进行全面源码审查，输出扩展建议和优化方案，涵盖架构、代码质量、安全性、性能、可维护性等维度。
todos:
  - id: fix-bugs-and-dead-code
    content: 修复 progress store 中 type 参数被写死为 compress 的 bug，合并 file.ts 中 scanVideoFiles/scanPlayerFiles 重复函数，替换 PlaylistPanel.vue 中 📁 emoji 为 lucide 图标，移除 unused deps
    status: completed
  - id: refactor-large-files
    content: 拆分 ffmpeg.ts 为 compress/gif/thumbnails 独立模块；拆分 PlayerView.vue 为 PlayerControls+ScreenshotPanel+composable 组合，使用 [subagent:code-explorer] 验证调用点完整
    status: completed
  - id: unify-types-and-enhance-lock
    content: 统一 VideoMeta 类型定义消除 preload/types 重复，lock.ts 添加超时释放机制，使用 [skill:universal-arch-skill] 验证架构一致性
    status: completed
    dependencies:
      - fix-bugs-and-dead-code
  - id: harden-security
    content: 提升 PBKDF2 迭代次数至 600000，扩展文件头格式支持版本号，添加 HMAC-SHA256 完整性认证（向后兼容旧格式）
    status: completed
    dependencies:
      - unify-types-and-enhance-lock
---

## 需求概述

对 SN Video Editor（Electron + Vue 3 + TypeScript 视频编辑桌面工具）进行全项目源码审查，识别现有问题并给出结构优化、代码质量提升和功能扩展方向的建设性方案。

## 项目现状

- 约 78 个源文件，9500+ 行代码
- 7 个核心功能模块：视频分割合并、压缩、加密解密、GIF 转换、m3u8 下载、播放器（含截图/播放列表）
- 架构清晰（三进程分离）、IPC 通信类型安全、FFmpeg 包装层健壮

## 需要解决的问题类别

### 代码质量与架构

- 大文件拆分：ffmpeg.ts (1262行)、PlayerView.vue (1190行)、SplitMergeView.vue (1033行)
- 类型重复：VideoMeta 在 preload 和 renderer/types 中重复定义
- 代码重复：scanVideoFiles / scanPlayerFiles 高度相似
- 死代码：progress.ts 中 start() 的 type 参数被忽略，写死为 'compress'
- emoji 替代：PlaylistPanel.vue 使用 📁 emoji 而非图标组件

### 安全加固

- PBKDF2 迭代次数提升（当前 10000，OWASP 推荐 600000+）
- 添加 HMAC 完整性认证标签
- 锁机制增强：添加超时释放和重入检测

### 依赖清理

- naive-ui、playwright 声明在 package.json 但源码中未使用

### 工程化

- 缺少 ESLint/Prettier 统一配置
- electron-builder.yml 发布地址为示例 URL，需替换
- 锁机制缺少超时释放

## 功能扩展方向

- 视频格式转码（mp4 / mov / avi / mkv 互转）
- 音频提取（从视频中提取音频并导出为 mp3 / wav / aac）
- 视频拼接（多个视频首尾拼接为一个长视频）
- 批量处理管道（批量压缩/转码/加密）
- 字幕编辑与硬编码（SRT/ASS 字幕导入合成）
- 视频裁剪（非时间轴分割，而是画面尺寸裁剪）

## 优化方案技术策略

### 总体思路

基于现有项目架构，坚持最小改动、最大收益、零架构侵入的原则，分优先级逐步推进优化。

### 1. 大文件拆分

**ffmpeg.ts (1262行)** 拆分为 4 个独立模块：

- `compress.ts` — 视频压缩相关（含 buildCompressArgs、compressVideo、2-pass 逻辑）
- `gif.ts` — GIF 转换相关（含 buildGifArgs、convertToGif、palette 双通道逻辑）
- `thumbnails.ts` — 缩略图相关（含 generateThumbnails、generateThumbnailSprite、VTT 生成）
- `ffmpeg.ts` 保留核心基础设施（二进制路径解析、split/merge、cancel 逻辑）

**PlayerView.vue (1190行)** 拆分规则：

- `PlayerControls.vue` — 播放控制栏（播放/暂停/进度条/速度/全屏）
- `ScreenshotPanel.vue` — 截图面板（单帧/自定义时间/批量/标记管理）
- `player.ts` (types 目录) — 截图标记管理逻辑提取到 composable
- PlayerView.vue 保留状态编排和组件组合

### 2. 类型统一

- 将 `VideoMeta`、`PlayerEntry` 等通用类型集中在 `preload/index.ts` 定义
- `renderer/src/types/file.ts` 改为从 preload re-export，消除重复声明
- 遵循 CLAUDE.md 中 preload 类型规则

### 3. 安全加固

**PBKDF2 迭代次数**：

- `crypto.ts` 中 ITERATIONS 常量从 10000 提升至 600000
- 注意：这会增加首次加密/解密延迟约 100-300ms，但安全性大幅提升
- 需要在文件头中存储迭代次数版本号，确保旧文件仍可解密

**HMAC 认证**：

- 64B 文件头格式需升级：16B IV + 16B Salt + 4B 迭代次数 + 28B 保留 → 64B
- 新增 HMAC-SHA256 签名追加到密文尾部（32B），解密时先验证再解密
- 向后兼容：检测版本号字段，旧格式跳过 HMAC 验证

### 4. 锁机制增强

- `lock.ts` 添加 `lockTimeout` 参数（默认 30 秒）
- 新增 `LockTimeoutError` 异常类型
- `acquireLock` 可选传入超时时间，超时自动释放并抛出
- 不会破坏现有调用方（为 `acquireLock` 参数添加默认值）

### 5. Bug 修复 + 重复消除

- `progress.ts`：`start()` 中 `progress.value.type` 改为使用传入的 `type` 参数
- `file.ts`：合并 `scanVideoFiles` / `scanPlayerFiles` 为一个通用 `scanFiles(dir, extensions)` 函数

### 6. 工程化改进

- `.eslintrc.cjs` 配置：基于 `@electron-toolkit/eslint-config-ts`，Vue 规则
- `PlaylistPanel.vue`：将 `📁` 替换为 `lucide-vue-next` 的 `FolderOpen` 图标
- 移除 package.json 中未使用的 naive-ui 和 playwright 依赖

### 7. 功能扩展方向（架构设计，暂不实现）

采用与现有模块一致的功能注册模式（8 步注册法）：

```
1. 创建 views/<FeatureName>/ 目录 + 主视图 + types/index.ts
2. 在 config/features.ts 添加 FEATURE_CONFIG 条目
3. 在 router/index.ts 添加路由记录
4. 在主进程 modules/ 添加对应功能模块（如需 FFmpeg 操作）
5. 在 preload 添加 IPC 桥接
```

建议扩展功能及技术方案：

| 功能 | 关键技术 | 复用模块 |
| --- | --- | --- |
| 格式转码 | ffmpeg.ts 通用入口封装 | ffprobe 获取格式信息 |
| 音频提取 | ffmpeg.ts 添加 extractAudio() | compress 的编码参数逻辑 |
| 视频拼接 | ffmpeg.ts concat demuxer | split 的文件列表逻辑 |
| 批量处理 | 新增 BatchProcessing 视图 + 队列 | progress store 队列模式 |
| 字幕硬编码 | ffmpeg.ts subtitles filter | ffprobe 流检测 |
| 画面裁剪 | ffmpeg.ts crop filter | compress 的 filter_complex |


## 实施次序

```
Phase 1 (立即):  Bug 修复 + 依赖清理 + emoji 替换
Phase 2 (优先):  大文件拆分 + 类型统一
Phase 3 (重要):  锁机制增强 + 代码重复消除
Phase 4 (安全):  PBKDF2 迭代次数提升 + HMAC 认证
Phase 5 (工程):  ESLint 配置 + electron-builder 发布地址更新
Phase 6 (可选):  功能扩展（按优先级逐项实现）
```

每个 phase 保证完全向后兼容，拆分后现有调用点无需改动（仅更改 import 路径）。

## Agent 扩展使用计划

### Skill

- **[skill:universal-arch-skill]**: 用于架构审查，验证大文件拆分后的目录结构和功能注册完整性，确保拆分解耦后不违反 6 大架构原则（功能模块化、注册完整性、类型安全单一数据源等）。在 Phase 2 大文件拆分和 Phase 5 工程化使用。
- **[skill:repo-scan]**: 用于 Phase 5 完成后对项目进行二次全量资产审计，与当前审计结果对比，验证优化效果并发现遗漏问题。

### SubAgent

- **[subagent:code-explorer]**: 在 Phase 2 大文件拆分时，用于精确扫描 ffmpeg.ts 中所有导出函数的调用点，确保拆分后 Import 路径替换完整无遗漏。