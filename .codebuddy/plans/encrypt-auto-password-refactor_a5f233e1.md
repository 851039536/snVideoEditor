---
name: encrypt-auto-password-refactor
overview: 移除加密功能的手动密码输入，改为从配置文件读取写死的默认密码自动完成加解密，并新增"获取密钥"按钮供第三方程序复制密钥。
todos:
  - id: create-crypto-config
    content: 在 src/renderer/src/config/crypto.ts 中创建默认密钥配置常量
    status: completed
  - id: refactor-encrypt-view
    content: 重构 EncryptView.vue：移除手动密码输入相关状态与UI，使用配置密钥自动注入所有加解密操作
    status: completed
    dependencies:
      - create-crypto-config
  - id: add-get-key-button
    content: 在加密页面新增"获取密钥"按钮，支持复制密钥到剪贴板并显示操作反馈
    status: completed
    dependencies:
      - refactor-encrypt-view
---

## 产品概述

将加密功能的密码输入方式从手动输入改为自动读取配置文件中的默认密码，简化用户操作流程。同时新增"获取密钥"按钮，方便第三方程序获取硬编码的密钥来解密已加密文件。

## 核心功能

- **自动密码注入**：加密/解密操作自动使用配置文件中写死的默认密码，移除所有手动密码输入 UI（密码输入框、确认密码框、密码强度条、显示/隐藏按钮）
- **默认密钥配置**：在 `src/renderer/src/config/crypto.ts` 新增配置文件，硬编码默认密钥常量，加密解密均从此读取
- **获取密钥按钮**：在加密页面新增"获取密钥"按钮，点击后将默认密码复制到剪贴板并显示操作反馈，供第三方解密程序使用
- **解密预览自动处理**：选择加密文件后自动使用默认密码生成解密预览，无需等待用户输入密码

## 技术栈

- 前端框架：Vue 3.4 + TypeScript + Composition API
- 状态管理：Pinia
- 剪贴板：`navigator.clipboard.writeText()`（原生 Web API）
- IPC 架构：Electron IPC（主进程 crypto 模块无需改动，密码仍通过参数传递）

## 实现方案

### 策略

在渲染进程层面新增配置文件 `config/crypto.ts` 导出默认密钥常量，EncryptView.vue 中移除所有密码相关 UI 和状态（password、confirmPassword、showPassword、passwordStrength、needsPasswordForPreview），改用配置常量直接传递密码。新增"获取密钥"按钮使用原生 `navigator.clipboard.writeText()` 复制密钥。

### 关键决策

1. **密码存放位置**：放在渲染进程 `config/crypto.ts` 中。主进程 crypto 模块的 IPC 接口（encryptFile/decryptFile/batchEncrypt/batchDecrypt）保持不变，密码仍通过参数从渲染进程传入，主进程无需感知密码来源是手动输入还是配置文件。
2. **解密预览自动触发**：移除 `watch(password)` 防抖逻辑，改为在文件列表变化时直接使用默认密码生成预览，无需等待用户输入。
3. **canStart 简化**：移除密码长度和确认密码校验，仅保留文件列表非空+输出目录已选的校验。
4. **"获取密钥"按钮位置**：放在原密码面板区域（glass-card 中），替换原来的密码输入 UI，保持页面布局结构不变。

### 性能与可靠性

- 移除密码防抖 watch（`previewDebounceTimer`），减少不必要的定时器开销
- 剪贴板操作使用标准 `navigator.clipboard` API，现代浏览器和 Electron 31 均原生支持
- settings store 中 `lastPassword` 相关逻辑保留但不再在 EncryptView 中调用，保持兼容性

## 实现细节

### 文件变更清单

```
src/renderer/src/
├── config/
│   └── crypto.ts                    # [NEW] 导出默认密钥常量 DEFAULT_ENCRYPT_KEY
├── views/Encrypt/
│   └── EncryptView.vue              # [MODIFY] 移除密码输入UI，使用配置密钥，新增获取密钥按钮
```

### 变更要点

**EncryptView.vue 脚本层（<script setup>）修改**：

- 新增 `import { DEFAULT_ENCRYPT_KEY } from '@/config/crypto'` 和 `import { Key } from 'lucide-vue-next'`
- 删除 `password`、`showPassword`、`confirmPassword` 三个 ref
- 删除 `passwordStrength`、`needsPasswordForPreview` 两个 computed
- 删除 `previewDebounceTimer` 及 `watch(password, ...)` 防抖逻辑
- 修改 `prepareDecryptPreview()`：将 `password.value.length < 4` 条件移除，直接使用默认密钥
- 修改 `canStart`：移除密码长度和确认密码校验
- 修改 `startProcess()`：将 `password.value` 替换为 `DEFAULT_ENCRYPT_KEY`，移除 `settingsStore.setLastPassword()` 调用
- 新增 `copyKeyToClipboard()`：调用 `navigator.clipboard.writeText(DEFAULT_ENCRYPT_KEY)` 并设置反馈状态
- 新增 `keyCopied` ref 用于控制"已复制"反馈显示

**EncryptView.vue 模板层修改**：

- 密码面板区域（479-527行 glass-card）替换为密钥信息面板，显示密钥摘要（前6位+***掩码）和"获取密钥"按钮
- 解密预览密码提示（399-404行 `needsPasswordForPreview`）移除，预览自动加载
- 加密说明文字更新：移除"请妥善保管密码"改为提示使用内置密钥，提及可通过"获取密钥"按钮导出

### 向后兼容性

- IPC 接口完全不变，主进程 crypto 模块零改动
- settings store 保留但 EncryptView 不再写入 lastPassword
- 已加密的文件可用新版本解密（密钥相同）