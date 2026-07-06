---
name: CompressView 编码选项联动逻辑修复
overview: 修复 CompressView 编码格式选项间的 4 处联动逻辑缺陷：GPU 切换不清除 twoPass、VP9 preset 无效、VP9 估值系数缺失、CRF 滑块范围未按编码器适配。
todos:
  - id: add-vp9-helper
    content: 在 codec.ts 和 ffmpeg-shared.ts 中新增 isVp9Codec 导出函数
    status: completed
  - id: fix-compress-view
    content: 修复 CompressView.vue：twoPass watcher 加 GPU 守卫、codecFactor 加 VP9、新增 crfMax/showPreset computed、crfValue 钳制 watch、模板 preset v-if 与 CRF slider max/labels
    status: completed
    dependencies:
      - add-vp9-helper
  - id: fix-ffmpeg-compress
    content: 修复 ffmpeg-compress.ts：import isVp9Codec，buildCompressArgs 中 -preset 推送条件增加 VP9 排除
    status: completed
    dependencies:
      - add-vp9-helper
---

## 用户需求

审查 CompressView 编码格式相关选项（codec / resolution / bitrate / crf / preset / twoPass / audioBitrate）之间的联动交互逻辑，修复发现的 4 处问题。

## 核心问题

1. **切换 GPU 编码不清除 twoPass**：combined watcher 仅在 `!bitrate` 时清 twoPass，不检查 GPU 状态。切到 NVENC/QSV 后 twoPass 值残留并持久化，切回 CPU 时自动恢复为 true。
2. **Preset 选项对 VP9 无效**：preset 值（ultrafast...veryslow）是 libx264/libx265 专用，libvpx-vp9 不支持，选 VP9 + 任意 preset 会导致 ffmpeg 报错。
3. **VP9 估值缺 codec 效率系数**：codecFactor 只给 H.265/HEVC 打 0.7 折扣，VP9 压缩率与 HEVC 接近却按 1.0 计算，预估偏大约 40%。
4. **CRF 滑块范围 H.264 专用**：libx264/libx265 范围 0-51，libvpx-vp9 范围 0-63。选 VP9 时上限偏低，刻度标签"51 最差"不准确。

## 技术栈

- 渲染进程：Vue 3.4 + TypeScript 5 + Composition API（`<script setup>`）
- 主进程：Electron 31 + Node.js child_process（spawn ffmpeg）
- 共享工具：`src/renderer/src/utils/codec.ts`（渲染层）+ `src/main/modules/ffmpeg-shared.ts`（主进程），跨进程同逻辑副本模式（已有 `isGpuCodec` 先例）

## 实现方案

### 策略

沿用已有的 `isGpuCodec` 跨进程副本模式，新增 `isVp9Codec` 辅助函数。所有 VP9 相关判断统一通过该函数，避免散落的 `includes('vp9')` 字符串匹配。

### 问题 1 修复：GPU 切换清除 twoPass

combined watcher 中增加 GPU 守卫：

```ts
watch([crfValue, resolution, bitrate, codec, audioBitrate, preset, twoPass], () => {
  if (!bitrate.value || isGpuEncoder.value) { twoPass.value = false }
  savePresetDebounced()
})
```

将 `!bitrate.value` 和 `isGpuEncoder.value` 合并为同一条件，任一为真即清除 twoPass。

### 问题 2 修复：Preset 对 VP9 隐藏 + 主进程跳过

- 渲染层：新增 `showPreset` computed（`!isGpuEncoder && !isVp9Codec(codec)`），模板 `v-if="showPreset"`
- 主进程：`buildCompressArgs` 中 `-preset` 推送条件增加 `!isVp9Codec`，VP9 不传 `-preset`（ffmpeg 使用 VP9 默认 preset "good"）

### 问题 3 修复：VP9 codecFactor

`estimateOutputSize` 中 codecFactor 判断增加 VP9：

```ts
const codecFactor = (codec.value || '').includes('265') || (codec.value || '').includes('hevc') || isVp9Codec(codec.value || '') ? 0.7 : 1.0
```

### 问题 4 修复：CRF 范围动态化

- 新增 `crfMax` computed：`isVp9Codec(codec) ? 63 : 51`
- 新增 `watch(codec)` 钳制 crfValue：若 crfValue > crfMax 则下调到 crfMax
- 模板 CRF slider `:max="crfMax"`，刻度末位标签 `{{ crfMax }} 最差`

## 实现备注

- **性能**：新增 computed 和 watcher 均为 O(1)，无性能影响。`estimateOutputSize` 在 v-for 中逐行调用但仅为简单算术，无需 memoize。
- **向后兼容**：`isVp9Codec` 为纯新增函数，不影响现有逻辑。crfValue 钳制仅在切换到 VP9 且 crfValue > 51 时触发，H.264/H.265 用户不受影响。
- **持久化**：钳制后的 crfValue 会通过现有 debounce 保存到 localStorage，下次加载时为合法值。
- **blast radius**：修改集中在 CompressView.vue + ffmpeg-compress.ts + 两个 codec 工具文件，不影响其他功能模块。

## 目录结构

```
src/
├── main/modules/
│   ├── ffmpeg-shared.ts            # [MODIFY] 新增 isVp9Codec 导出函数
│   └── ffmpeg-compress.ts          # [MODIFY] import isVp9Codec；buildCompressArgs 中 -preset 条件增加 VP9 排除
├── renderer/src/
│   ├── utils/
│   │   └── codec.ts                # [MODIFY] 新增 isVp9Codec 导出函数
│   └── views/Compress/
│       └── CompressView.vue        # [MODIFY] import isVp9Codec；twoPass watcher 修复；codecFactor 修复；crfMax/showPreset computed；crfValue 钳制 watch；模板 preset v-if + CRF slider max/labels
```

## 关键代码结构

```typescript
// src/renderer/src/utils/codec.ts — 新增
export function isVp9Codec(codec: string): boolean {
  return codec.includes('vp9')
}

// src/main/modules/ffmpeg-shared.ts — 新增（同逻辑副本）
export function isVp9Codec(codec: string): boolean {
  return codec.includes('vp9')
}

// CompressView.vue — 新增 computed
const crfMax = computed(() => isVp9Codec(codec.value) ? 63 : 51)
const showPreset = computed(() => !isGpuEncoder.value && !isVp9Codec(codec.value))
```