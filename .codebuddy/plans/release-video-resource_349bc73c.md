---
name: release-video-resource
overview: 新增 releaseVideoResource 辅助函数显式释放 video 元素（pause + 清 src + load），在切 merge 模式、移除源视频、组件卸载三处调用，消除合并完成后源视频文件句柄/解码线程的残留占用。
todos:
  - id: add-release-fn
    content: 新增 releaseVideoResource 辅助函数（pause + removeAttribute src + load）
    status: completed
  - id: wire-release-calls
    content: 在 watch(mode) merge 分支、removeFile、onUnmounted 三处调用 releaseVideoResource
    status: completed
    dependencies:
      - add-release-fn
---

## 用户需求

确认并修复"裁剪完成合并后，源视频仍占用线程"的问题。

## 问题概述

合并发生在 merge 模式，切换到 merge 时 `<video>` 元素虽被 v-if 卸载，但 Chromium 对 `file:///` 协议的 media 资源（文件句柄、解码线程）释放有延迟。当前代码未显式释放 video 资源，导致合并完成后源视频仍可能占用线程/文件句柄。

## 核心修复

新增 `releaseVideoResource()` 辅助函数（pause + 移除 src + load 触发 Chromium 释放 media pipeline），在切换模式、移除文件、组件卸载三处调用，确保源视频资源被即时释放。

## 技术栈

- Vue 3.4 Composition API（`<script setup lang="ts">`）
- 无新增依赖，仅修改 `SplitMergeView.vue`

## 实现方案

Chromium 的 `<video>` 元素使用 `file:///` + `preload="auto"` 时，Vue 的 v-if 卸载仅移除 DOM 节点，不立即停止 media 解码线程和释放文件句柄。需显式调用三步释放：`pause()` 停止解码 → `removeAttribute('src')` 移除文件引用 → `load()` 触发 Chromium 释放当前 media resource（句柄 + 解码线程）。

封装为 `releaseVideoResource()` 辅助函数，内部对 `videoPlayer.value` 做 null 守卫，在 3 个释放缺口处调用：

1. `watch(mode)` merge 分支：切到合并模式时先释放再清空 files
2. `removeFile`：split 模式移除源视频导致 files 清空时释放
3. `onUnmounted`：组件卸载时释放

## 实现注意事项

- `releaseVideoResource` 与 `cutToClipList` 已有的 `videoPlayer.value?.pause()` 不冲突（裁剪时暂停、切换/卸载时彻底释放）
- `removeAttribute('src')` + `load()` 后，`videoSrc` computed 仍由 `files` 派生，切回 split 重新 addFiles 时 video 正常重新加载，无回归
- video 元素事件监听（onVideoError/onVideoLoaded 等）随 v-if 卸载由 Vue 自动移除，无需手动清理
- 仅影响渲染进程，不涉及 IPC 接口与主进程