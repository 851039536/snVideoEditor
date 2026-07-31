<!-- 视频截图弹窗：当前画面 / 指定时间 / 批量截图三种模式 -->
<script setup lang="ts">
import { computed } from 'vue';
import { Camera, Image, Loader } from 'lucide-vue-next';
import { secondsToHMS } from '@/utils/time';

const props = defineProps<{
  show: boolean;
  capturing: boolean;
  captureProgress: { current: number; total: number };
  currentFileName: string;
  duration: number;
  currentTime: number;
}>();

defineEmits<{
  close: [];
  captureCurrent: [];
  captureByTime: [];
  batchCapture: [];
}>();

// 截图模式与输入项状态由父级 useScreenshot 持有，此处双向绑定
const screenshotMode = defineModel<'current' | 'custom' | 'batch'>('screenshotMode', { required: true });
const screenshotTimeInput = defineModel<string>('screenshotTimeInput', { required: true });
const batchInterval = defineModel<number>('batchInterval', { required: true });

/** 预估批量截图帧数（防护非法 interval 和 duration） */
const estimatedFrames = computed((): number => {
  if (!props.duration || props.duration <= 0) {
    return 0;
  }
  const interval = batchInterval.value;
  if (!interval || interval < 1) {
    return 0;
  }
  return Math.floor(props.duration / interval);
});

/** 批量进度百分比 */
const progressPercent = computed((): number => {
  const { current, total } = props.captureProgress;
  return total > 0 ? (current / total) * 100 : 0;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="$emit('close')"
    >
      <div class="glass-card w-full max-w-md mx-4" @click.stop>
        <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Camera :size="18" class="text-accent-purple" />
          视频截图
          <span class="text-xs text-text-muted ml-auto">{{ currentFileName }}</span>
        </h3>

        <!-- Mode Tabs -->
        <div class="flex border-b border-bg-tertiary mb-4">
          <button
            v-for="mode in ['current', 'custom', 'batch'] as const"
            :key="mode"
            @click="screenshotMode = mode"
            class="flex-1 pb-2 text-xs font-medium border-b-2 transition-colors"
            :class="
              screenshotMode === mode
                ? 'border-accent-purple text-accent-purple'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            "
          >
            {{ mode === 'current' ? '当前画面' : mode === 'custom' ? '指定时间' : '批量截图' }}
          </button>
        </div>

        <!-- Current Frame -->
        <div v-if="screenshotMode === 'current'" class="space-y-3">
          <div class="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary/40">
            <Image :size="32" class="text-text-muted" />
            <div>
              <p class="text-sm text-text-primary">截取当前播放画面</p>
              <p class="text-xs text-text-muted">时间点：{{ secondsToHMS(currentTime) }}</p>
            </div>
          </div>
          <button
            @click="$emit('captureCurrent')"
            :disabled="capturing"
            class="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-accent-purple to-pink-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Loader v-if="capturing" :size="14" class="animate-spin" />
            <Camera v-else :size="14" />
            {{ capturing ? '截图中...' : '截取当前画面' }}
          </button>
        </div>

        <!-- Custom Time -->
        <div v-else-if="screenshotMode === 'custom'" class="space-y-3">
          <div>
            <label class="text-xs text-text-secondary mb-1 block">截图时间点</label>
            <input
              v-model="screenshotTimeInput"
              type="text"
              placeholder="秒数，如 30 或 1:30"
              class="input-base w-full"
              :disabled="capturing"
              @keyup.enter="$emit('captureByTime')"
            />
            <p class="text-xs text-text-muted mt-1">支持格式：秒数（30）、分:秒（1:30）、时:分:秒（0:01:30）</p>
          </div>
          <button
            @click="$emit('captureByTime')"
            :disabled="!screenshotTimeInput || capturing"
            class="w-full px-4 py-2.5 rounded-lg bg-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Loader v-if="capturing" :size="14" class="animate-spin" />
            截图
          </button>
        </div>

        <!-- Batch -->
        <div v-else class="space-y-3">
          <div v-if="!capturing">
            <label class="text-xs text-text-secondary mb-1 block">截图间隔（秒）</label>
            <input v-model.number="batchInterval" type="number" min="1" step="1" class="input-base w-full" />
            <p class="text-xs text-text-muted mt-1">
              预计 {{ estimatedFrames }} 帧，每 {{ batchInterval >= 1 ? batchInterval : 1 }} 秒一帧
            </p>
          </div>

          <!-- Progress bar (batch only) -->
          <div v-if="capturing" class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-text-secondary">批量截图进度</span>
              <span class="text-text-primary font-mono">
                {{ captureProgress.current }} / {{ captureProgress.total }}
              </span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
              <div
                class="h-full rounded-full bg-gradient-to-r from-accent-purple to-pink-500 transition-all duration-300"
                :style="{ width: progressPercent + '%' }"
              />
            </div>
          </div>

          <button
            @click="$emit('batchCapture')"
            :disabled="capturing || !batchInterval || batchInterval < 1 || duration <= 0"
            class="w-full px-4 py-2.5 rounded-lg bg-accent-purple text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Loader v-if="capturing" :size="14" class="animate-spin" />
            {{ capturing ? '批量截图中...' : '开始批量截图' }}
          </button>
        </div>

        <!-- Output hint -->
        <p class="text-xs text-text-muted mt-4 pt-3 border-t border-bg-tertiary">保存位置：视频文件同目录</p>
      </div>
    </div>
  </Teleport>
</template>
