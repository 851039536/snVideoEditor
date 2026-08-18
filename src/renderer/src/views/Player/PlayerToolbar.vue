<!-- 播放器工具栏：上下曲、播放模式、标记、A-B 循环、逐帧、倍速与控件栏开关 -->
<script setup lang="ts">
import {
  SkipBack,
  SkipForward,
  Repeat,
  Eye,
  EyeOff,
  Bookmark,
  X,
  StepBack,
  StepForward,
  PictureInPicture,
  Gauge
} from 'lucide-vue-next';
import { secondsToHMS } from '@/utils/time';
import type { PlayMode } from './types';

defineProps<{
  canPrev: boolean;
  canNext: boolean;
  playMode: PlayMode;
  playModeLabel: string;
  playModeIcon: typeof Repeat;
  showControlsOverlay: boolean;
  autoHideControls: boolean;
  loopStart: number | null;
  loopEnd: number | null;
  currentSpeed: number;
  speedOptions: number[];
  markerCount: number;
}>();

defineEmits<{
  prev: [];
  next: [];
  cycleMode: [];
  toggleOverlay: [];
  toggleAutoHide: [];
  addMarker: [];
  clearMarkers: [];
  setLoopA: [];
  setLoopB: [];
  clearLoop: [];
  stepBackward: [];
  stepForward: [];
  togglePip: [];
  setSpeed: [speed: number];
}>();
</script>

<template>
  <div class="player-toolbar flex flex-wrap items-center gap-1 px-3 py-2 border-t border-bg-tertiary/60">
    <!-- Previous -->
    <button
      @click="$emit('prev')"
      :disabled="!canPrev"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
      title="上一首 (P)"
    >
      <SkipBack :size="13" />
    </button>

    <!-- Next -->
    <button
      @click="$emit('next')"
      :disabled="!canNext"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
      title="下一首 (N)"
    >
      <SkipForward :size="13" />
    </button>

    <!-- Play mode -->
    <button
      @click="$emit('cycleMode')"
      :class="
        playMode !== 'sequential' ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-secondary'
      "
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
      :title="'播放模式：' + playModeLabel + ' (L)'"
    >
      <component :is="playModeIcon" :size="13" />
      <span class="hidden sm:inline">{{ playModeLabel }}</span>
    </button>

    <span class="w-px h-4 bg-bg-tertiary" />

    <!-- Controls Overlay Toggle -->
    <button
      @click="$emit('toggleOverlay')"
      :class="
        showControlsOverlay ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-secondary'
      "
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
      :title="showControlsOverlay ? '隐藏控件栏' : '显示控件栏'"
    >
      <Eye v-if="!showControlsOverlay" :size="13" />
      <EyeOff v-else :size="13" />
      <span class="hidden sm:inline">控件栏</span>
    </button>

    <span class="w-px h-4 bg-bg-tertiary" />

    <!-- Add Marker -->
    <button
      @click="$emit('addMarker')"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-accent-purple hover:bg-accent-purple/10"
      title="在当前播放位置添加标记"
    >
      <Bookmark :size="13" />
      <span class="hidden sm:inline">标记</span>
    </button>

    <!-- Clear All Markers -->
    <button
      v-if="markerCount > 0"
      @click="$emit('clearMarkers')"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-danger hover:bg-danger/10"
      title="清除全部标记（右键单个标记可单独删除）"
    >
      <X :size="13" />
      <span class="hidden sm:inline">清除 ({{ markerCount }})</span>
    </button>

    <span class="w-px h-4 bg-bg-tertiary" />

    <!-- A-B Loop -->
    <button
      @click="$emit('setLoopA')"
      :class="loopStart !== null ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-secondary'"
      class="px-1.5 py-1 rounded text-xs font-mono font-semibold transition-colors"
      :title="loopStart !== null ? 'A 点：' + secondsToHMS(loopStart) : '设置循环起点 A'"
    >
      A
    </button>
    <button
      @click="$emit('setLoopB')"
      :disabled="loopStart === null"
      :class="loopEnd !== null ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-secondary'"
      class="px-1.5 py-1 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      :title="loopEnd !== null ? 'B 点：' + secondsToHMS(loopEnd) : '设置循环终点 B'"
    >
      B
    </button>
    <button
      v-if="loopStart !== null || loopEnd !== null"
      @click="$emit('clearLoop')"
      class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-danger hover:bg-danger/10"
      title="清除 A-B 循环"
    >
      <X :size="13" />
    </button>

    <span class="w-px h-4 bg-bg-tertiary" />

    <!-- Frame step -->
    <button
      @click="$emit('stepBackward')"
      class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
      title="上一帧 (,)"
    >
      <StepBack :size="13" />
    </button>
    <button
      @click="$emit('stepForward')"
      class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
      title="下一帧 (.)"
    >
      <StepForward :size="13" />
    </button>

    <!-- Picture in Picture -->
    <button
      @click="$emit('togglePip')"
      class="flex items-center px-1.5 py-1 rounded text-xs font-medium transition-colors text-text-muted hover:text-text-secondary"
      title="画中画 (I)"
    >
      <PictureInPicture :size="13" />
    </button>

    <span class="w-px h-4 bg-bg-tertiary ml-auto" />

    <!-- Speed Quick Selector -->
    <div class="flex items-center gap-0.5">
      <Gauge :size="12" class="text-text-muted mr-1" />
      <button
        v-for="s in speedOptions"
        :key="s"
        @click="$emit('setSpeed', s)"
        :class="
          currentSpeed === s
            ? 'text-accent-blue bg-accent-blue/10 border-accent-blue/30'
            : 'text-text-muted border-transparent hover:text-text-secondary'
        "
        class="px-1.5 py-0.5 rounded text-xs font-mono font-medium transition-all border"
      >
        {{ s }}×
      </button>
    </div>

    <span class="w-px h-4 bg-bg-tertiary" />

    <!-- Auto-Hide Controls Toggle -->
    <button
      @click="$emit('toggleAutoHide')"
      :class="autoHideControls ? 'text-text-muted' : 'text-accent-blue bg-accent-blue/10'"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-bg-tertiary/40"
      :title="autoHideControls ? '自动隐藏控件：开' : '自动隐藏控件：关'"
    >
      <span>{{ autoHideControls ? '自动隐藏：开' : '自动隐藏：关' }}</span>
    </button>
  </div>
</template>
