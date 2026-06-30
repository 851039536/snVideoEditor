---
name: player-persistence
overview: 为 Player 播放器模块添加播放列表、播放进度、上次扫描文件夹、autoDecrypt 开关的 localStorage 持久化，遵循项目现有的 Pinia + watch 自动保存模式
todos:
  - id: extend-types
    content: 扩展 views/Player/types/index.ts 新增 PersistedPlayerData 接口和默认值常量
    status: completed
  - id: extend-store
    content: 扩展 stores/settings.ts：新增 playerData ref、load/set 函数、watch(deep) localStorage 持久化
    status: completed
    dependencies:
      - extend-types
  - id: integrate-persistence
    content: 修改 PlayerView.vue：onMounted 从 store 加载恢复 playlist/folder/autoDecrypt，watch 核心状态自动保存
    status: completed
    dependencies:
      - extend-store
  - id: folder-memory
    content: 实现文件夹记忆：selectDir 后保存路径，PlaylistPanel 新增"上次扫描"快捷按钮
    status: completed
    dependencies:
      - integrate-persistence
  - id: playback-resume
    content: 实现播放进度续播：pause/ended/unmounted 时记录 currentTime，playFile 后恢复进度
    status: completed
    dependencies:
      - integrate-persistence
---

## 用户需求

为 Player 播放器模块添加持久化能力，使以下状态在应用重启后自动恢复：

1. **播放列表持久化**——重启后自动恢复上次的文件列表（跳过已不存在的文件）
2. **文件夹记忆**——记住上次"扫描文件夹"选择的目录路径，方便一键重新加载
3. **autoDecrypt 开关持久化**——记住用户偏好的自动/手动解密模式
4. **播放进度记录**——记住上次播放位置，支持续播

## 核心功能

- 播放列表自动保存：添加/删除/清空/拖拽排序文件时自动同步到 localStorage
- 文件夹路径记忆：`selectDir()` 选择目录后保存，渲染层显示"上次扫描"快捷入口
- 开关记忆：`autoDecrypt` 切换即时保存，下次启动使用上次设置
- 播放进度：暂停/结束/切换文件时记录当前秒数，下次打开该文件从断点续播
- 路径失效处理：恢复时若文件路径不存在，静默跳过并在 error 提示中告知跳过数量

## 技术方案

### 持久化策略

沿用项目现有的 **Pinia store + localStorage + watch** 模式（与 `theme`、`compressPreset` 完全一致），在 `stores/settings.ts` 中新增 `playerData` 状态。

### 数据模型

```typescript
interface PersistedPlayerData {
  filePaths: string[]     // 播放列表文件路径
  lastFolder: string      // 上次扫描的文件夹路径
  autoDecrypt: boolean    // 自动解密开关
  lastIndex: number       // 上次播放索引
  playbackTime: number    // 播放进度（秒）
}
```

- **不持久化**：`tempPath`（临时文件）、`meta`（重新加载）、`passwordInput`/`showPasswordModal` 等瞬态 UI 状态

### 文件路径验证

渲染进程无法使用 `fs.existsSync`。采用**乐观恢复 + 静默跳过**策略：

- 直接恢复保存的文件路径列表
- 加载 meta 时由 `loadAllMeta` 的 `Promise.allSettled` 自动处理失败的条目（已存在此逻辑）
- 在 error 提示中告知用户有多少文件恢复失败

### 播放进度恢复

- 通过 Plyr 实例的 `player.currentTime` 获取当前秒数
- 在 `pause`/`ended` 事件及 `onUnmounted` 时保存
- `playFile()` 完成后通过 `player.currentTime = savedTime` 恢复进度
- 进度按文件路径索引存储，切换文件时对应更新

### 存储键名

```
snve-player-data    → JSON.stringify(PersistedPlayerData)
```

### 数据流

```
用户操作 → PlayerView.vue 状态变化 → watch → settingsStore.setPlayerData()
                                                      ↓
settings.ts  watch(deep:true) → localStorage.setItem()
                                                      ↓
下次启动 → loadPlayerData() → localStorage.getItem() → 恢复状态 → PlayerView.vue onMounted
```