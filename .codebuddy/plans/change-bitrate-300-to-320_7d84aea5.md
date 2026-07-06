---
name: change-bitrate-300-to-320
overview: 将 CompressView.vue 中码率预设值 `300k` 改为 `320k`
todos:
  - id: update-bitrate-300-to-320
    content: 将 CompressView.vue 中 3 处 300k 码率改为 320k
    status: completed
---

将视频压缩功能中 480p（854:480）和 360p（640:360）分辨率对应的默认码率从 300 Kbps 修改为 320 Kbps。

## 修改内容

在 `src/renderer/src/views/Compress/CompressView.vue` 中，将以下 3 处 `300k` 替换为 `320k`：

1. **第 141 行** — `RESOLUTION_BITRATE` 映射表，480p 分辨率默认码率
2. **第 142 行** — `RESOLUTION_BITRATE` 映射表，360p 分辨率默认码率
3. **第 449 行** — 码率下拉选择器的选项值和显示文本