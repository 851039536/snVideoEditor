<!-- 变速操作面板：单段快捷变速 + 批量变速双模式 -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Folder, Zap, Plus, Trash2, Play, Square } from 'lucide-vue-next'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { secondsToHMS } from '@/utils/time'
import { useSpeedBatch } from '@/composables/useSpeedBatch'
import { useSpeedPreview } from '@/composables/useSpeedPreview'

const props = defineProps<{
  inputFile: string
  trimStartSec: number
  trimDuration: number
  duration: number
  sourceCodec?: string
}>()

const emit = defineEmits<{
  error: [msg: string]
  added: []
}>()

const store = useProgressStore()
const { speedSegments, errorMsg, canBatch, addSegment, removeSegment, updateSegmentSpeed, clearSegments, startBatchSpeed, startSingle } = useSpeedBatch()
const { isPreviewing, previewLabel, startSpeedPreview, stopSpeedPreview } = useSpeedPreview()

// ---- 速度状态 ----
const speedFactor = ref(1.0)
const outputDir = ref('')

// 替换源文件后重置输出路径并清空待变速段，避免旧状态指向新文件
watch(() => props.inputFile, () => {
  outputDir.value = ''
  clearSegments()
})

// 批量执行的错误信息转发给父组件统一展示（父组件已有 errorMsg 显示区）
watch(errorMsg, (msg) => {
  if (msg) {
    emit('error', msg)
  }
})

// 完整速度档位（预设按钮组不含 1.0x，下拉选择含 1.0x）
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const SPEED_PRESETS = SPEED_OPTIONS.filter((s) => s !== 1)

// 变速后输出时长预览
const outputDurationStr = computed((): string => {
  if (props.trimDuration <= 0 || speedFactor.value <= 0) { return '00:00:00' }
  return secondsToHMS(props.trimDuration / speedFactor.value)
})

const canExecute = computed((): boolean => {
  return props.trimDuration > 0 && speedFactor.value > 0 && !store.isProcessing
})

// 加入待变速与预览共用同一可用条件（区间有效且无进行中的操作）
const canOperate = computed((): boolean => {
  return props.trimDuration > 0 && !store.isProcessing
})

// ---- 操作 ----

async function selectOutputPath(): Promise<void> {
  const name = props.inputFile.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'output'
  const path = await window.electronAPI.selectSavePath(`${name}_speed${speedFactor.value}x.mp4`, 'mp4')
  if (path) {
    outputDir.value = path
  }
}

async function startSpeedChange(): Promise<void> {
  if (!outputDir.value) {
    await selectOutputPath()
    if (!outputDir.value) {
      emit('error', '请选择输出路径')
      return
    }
  }

  emit('error', '')
  await startSingle(props.inputFile, outputDir.value, props.trimStartSec, props.trimDuration, speedFactor.value)
}

/** 将当前时间轴区间添加为待变速段，并通知父组件推进手柄 */
function onAddSegment(): void {
  addSegment(props.trimStartSec, props.trimStartSec + props.trimDuration, speedFactor.value)
  emit('added')
}

/** 预览当前选中区间的变速效果（再次点击则停止） */
function onPreviewCurrent(): void {
  if (isPreviewing.value) { stopSpeedPreview(); return }
  startSpeedPreview(props.trimStartSec, props.trimDuration, speedFactor.value)
}

async function onBatchStart(): Promise<void> {
  if (speedSegments.value.length === 0) {
    emit('error', '请先添加待变速片段')
    return
  }
  if (!outputDir.value) {
    await selectOutputPath()
    if (!outputDir.value) {
      emit('error', '请选择输出路径')
      return
    }
  }
  emit('error', '')
  await startBatchSpeed(props.inputFile, outputDir.value, props.duration, props.sourceCodec || '')
}
</script>

<template>
  <div class="glass-card space-y-4">
    <h3 class="text-sm font-semibold text-text-primary flex items-center gap-2">
      <Zap :size="15" class="text-accent-blue" />
      变速设置
    </h3>

    <!-- ========== 单段快捷区 ========== -->
    <!-- 速度预设按钮组 -->
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="preset in SPEED_PRESETS"
        :key="preset"
        @click="speedFactor = preset"
        class="px-2.5 py-1 rounded-md text-xs font-mono transition-all"
        :class="Math.abs(speedFactor - preset) < 0.001
          ? 'bg-accent-blue text-white shadow-sm'
          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80'"
      >
        {{ preset }}x
      </button>
    </div>

    <!-- 自定义滑块 -->
    <div class="flex items-center gap-3">
      <span class="text-xs text-text-muted w-8">慢</span>
      <input
        type="range"
        v-model.number="speedFactor"
        min="0.25"
        max="4"
        step="0.05"
        class="flex-1 h-1.5 accent-accent-blue cursor-pointer"
      />
      <span class="text-xs text-text-muted w-8">快</span>
      <span class="text-sm font-mono text-accent-blue font-semibold w-14 text-right">
        {{ speedFactor.toFixed(2) }}x
      </span>
    </div>

    <!-- 信息展示 -->
    <div class="flex items-center gap-4 text-xs text-text-secondary">
      <span>原片段时长：<span class="font-mono text-text-primary">{{ secondsToHMS(trimDuration) }}</span></span>
      <span>→</span>
      <span>变速后：<span class="font-mono text-accent-blue font-semibold">{{ outputDurationStr }}</span></span>
    </div>

    <!-- 单段执行 -->
    <div class="flex items-center gap-2">
      <button
        @click="startSpeedChange"
        :disabled="!canExecute"
        class="px-6 py-2 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
        :class="canExecute
          ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
          : 'bg-bg-tertiary text-text-muted'"
      >
        <Zap :size="16" class="inline mr-1.5 -mt-0.5" />
        单段变速
      </button>
      <button
        @click="onPreviewCurrent"
        :disabled="!canOperate"
        class="px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed border border-accent-purple/40 text-accent-purple hover:bg-accent-purple/10"
      >
        <Square v-if="isPreviewing" :size="14" class="inline mr-1 -mt-0.5" />
        <Play v-else :size="14" class="inline mr-1 -mt-0.5" />
        {{ isPreviewing ? '停止预览' : '预览变速' }}
      </button>
      <button
        @click="onAddSegment"
        :disabled="!canOperate"
        class="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10"
        title="将当前时间轴区间加入待变速列表"
      >
        <Plus :size="14" class="inline mr-1 -mt-0.5" />
        加入待变速
      </button>
      <span class="text-xs text-text-muted">单段变速输出为片段，非完整视频</span>
    </div>

    <!-- 预览状态提示 -->
    <p v-if="isPreviewing" class="text-xs text-accent-purple">{{ previewLabel }}</p>

    <!-- ========== 批量区 ========== -->
    <div v-if="speedSegments.length > 0" class="space-y-2">
      <h4 class="text-xs font-semibold text-text-primary">待变速片段（{{ speedSegments.length }} 段）</h4>
      <div
        v-for="seg in speedSegments"
        :key="seg.id"
        class="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary/50"
      >
        <span class="text-xs font-mono text-text-secondary flex-1 min-w-0">
          {{ secondsToHMS(seg.startSec) }} ~ {{ secondsToHMS(seg.endSec) }}
          <span class="text-text-muted">（{{ seg.duration.toFixed(1) }}s）</span>
        </span>
        <select
          :value="seg.speed"
          @change="updateSegmentSpeed(seg.id, Number(($event.target as HTMLSelectElement).value))"
          class="px-1.5 py-0.5 text-xs font-mono bg-bg-primary border border-border rounded text-text-primary outline-none cursor-pointer"
        >
          <option v-for="p in SPEED_OPTIONS" :key="p" :value="p">{{ p }}x</option>
        </select>
        <button
          @click="startSpeedPreview(seg.startSec, seg.duration, seg.speed)"
          class="p-1 rounded hover:bg-accent-blue/10 text-text-muted hover:text-accent-blue transition-colors"
          title="试听此段变速效果"
        >
          <Play :size="13" />
        </button>
        <button
          @click="removeSegment(seg.id)"
          class="p-1 rounded hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
          title="移除片段"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <button
          @click="onBatchStart"
          :disabled="!canBatch"
          class="px-6 py-2 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="canBatch
            ? 'bg-gradient-to-r from-accent-purple to-pink-500'
            : 'bg-bg-tertiary text-text-muted'"
        >
          <Zap :size="16" class="inline mr-1.5 -mt-0.5" />
          批量变速并合并
        </button>
        <span class="text-xs text-text-muted">变速段重编码 + 未变速段拼接，输出完整视频</span>
      </div>
    </div>

    <!-- 输出路径 -->
    <div class="flex items-center gap-3">
      <button @click="selectOutputPath" class="btn-secondary text-xs">
        <Folder :size="14" />
        选择输出位置
      </button>
      <p v-if="outputDir" class="text-xs text-accent-light truncate flex-1">{{ outputDir }}</p>
    </div>

    <!-- 进度面板 -->
    <ProgressPanel />
  </div>
</template>
