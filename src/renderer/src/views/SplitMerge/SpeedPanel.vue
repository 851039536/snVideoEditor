<!-- 变速操作面板：速度选择、输出设置与执行 -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Folder, Zap } from 'lucide-vue-next'
import ProgressPanel from '@/components/ProgressPanel.vue'
import { useProgressStore } from '@/stores/progress'
import { secondsToHMS } from '@/utils/time'

const props = defineProps<{
  inputFile: string
  trimStartSec: number
  trimDuration: number
}>()

const emit = defineEmits<{
  error: [msg: string]
}>()

const store = useProgressStore()

// ---- 速度状态 ----
const speedFactor = ref(1.0)
const outputDir = ref('')

// 替换源文件后重置输出路径，避免输出指向旧文件目录
watch(() => props.inputFile, () => {
  outputDir.value = ''
})

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 2.0, 3.0, 4.0]

// 变速后输出时长预览
const outputDurationStr = computed((): string => {
  if (props.trimDuration <= 0 || speedFactor.value <= 0) { return '00:00:00' }
  return secondsToHMS(props.trimDuration / speedFactor.value)
})

const canExecute = computed((): boolean => {
  return props.trimDuration > 0 && speedFactor.value > 0 && !store.isProcessing
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
  store.start('speed')

  try {
    const result = await window.electronAPI.changeSpeed({
      input: props.inputFile,
      output: outputDir.value,
      startTime: props.trimStartSec,
      duration: props.trimDuration,
      speed: speedFactor.value
    })
    if (result) {
      store.finish()
    } else {
      store.reset()
    }
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e))
    store.reset()
  }
}
</script>

<template>
  <div class="glass-card space-y-4">
    <h3 class="text-sm font-semibold text-text-primary flex items-center gap-2">
      <Zap :size="15" class="text-accent-blue" />
      变速设置
    </h3>

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

    <!-- 输出路径 -->
    <div class="flex items-center gap-3">
      <button @click="selectOutputPath" class="btn-secondary text-xs">
        <Folder :size="14" />
        选择输出位置
      </button>
      <p v-if="outputDir" class="text-xs text-accent-light truncate flex-1">{{ outputDir }}</p>
    </div>

    <!-- 执行按钮 -->
    <div class="flex items-center gap-3">
      <button
        @click="startSpeedChange"
        :disabled="!canExecute"
        class="px-6 py-2 rounded-xl font-semibold text-white transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
        :class="canExecute
          ? 'bg-gradient-to-r from-accent-blue to-accent-purple'
          : 'bg-bg-tertiary text-text-muted'"
      >
        <Zap :size="16" class="inline mr-1.5 -mt-0.5" />
        开始变速
      </button>
      <span class="text-xs text-text-muted">变速需要重新编码，耗时与片段长度成正比</span>
    </div>

    <!-- 进度面板 -->
    <ProgressPanel />
  </div>
</template>
