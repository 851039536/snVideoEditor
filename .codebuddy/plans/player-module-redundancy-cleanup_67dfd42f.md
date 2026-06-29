---
name: player-module-redundancy-cleanup
overview: 清理 Player 模块 8 处冗余：提取 3 个共享 helper 消除重复逻辑、修复误导缩进/过时注释/空注释块、标记 fire-and-forget 调用。
todos:
  - id: extract-helpers
    content: 提取 destroyPlayer()、decryptAndPlay(file,password) helper，抽取 clearList 中的 player-destroy 代码和 decrypt 流程到共享函数，消除 3 处 player.destroy 重复 + 2 处 decrypt 流程重复 + 2 处 getTempDir IPC 重复 + 2 处 temp 清理逻辑重复
    status: completed
  - id: fix-misc
    content: 修复 addFilesAndLoadMeta 中 loadAllMeta 加 void 前缀、模板中 relative bg-black div 缩进、initAndPlay 过时注释、_player.scss 空注释块
    status: completed
    dependencies:
      - extract-helpers
---

清理 Player 模块中 8 处代码冗余，包括：提取共享 helper 消除重复逻辑、移除重复 IPC 调用、修复模板缩进和过时注释。

涉及文件：PlayerView.vue（7 处）、_player.scss（1 处）。

## 技术方案

### 改动范围

仅修改 `src/renderer/src/views/Player/PlayerView.vue`（script + template）和 `_player.scss`。不涉及 preload/IPC/其他模块。

### 改动策略

#### 1. 提取 `destroyPlayer()` helper（消除 3 处重复）

```ts
function destroyPlayer(): void {
  if (player) {
    try { player.destroy() } catch (_e) { /* ignore */ }
    player = null
  }
  isPlaying.value = false
}
```

替换 `initAndPlay`、`clearList`、`onUnmounted` 中的 3 处手写 player-destroy 代码块。

#### 2. 提取 `decryptAndPlay(file, password)` helper（消除 2 处重复）

`decryptWithDefaultKey` 和 `confirmDecrypt` 中都包含：decryptForPlayback → 检查切走 → 记录 tempPath → loadMeta → nextTick → initAndPlay。提取为公共 `decryptAndPlay()`，两个调用方各传入不同 password（DEFAULT_ENCRYPT_KEY 或 passwordInput.value）。

`confirmDecrypt` 特有的旧 tempPath 清理逻辑并入 helper（幂等安全），模态框关闭在调用前完成。

`decryptAndPlay` 内部使用模块级 `tempDir.value` 替代重复 IPC 调用。

#### 3. `clearList()` 复用 `cleanupAllTemps()`

将 `clearList` 中的手动清理循环替换为 `await cleanupAllTemps()`，函数改为 async。

#### 4. `addFilesAndLoadMeta` 中 `loadAllMeta()` 加 `void` 前缀

`void loadAllMeta()` 显式表达 fire-and-forget 意图。

#### 5. 模板缩进修正

将 `relative bg-black` div 缩进 +2，正确反映它是 `video-player-wrapper` 的子元素。

#### 6. 注释修正

`// :key="videoSrc"` → `// :key="playerKey"`

#### 7. 删除 `_player.scss` 空注释块