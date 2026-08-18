/**
 * 播放队列 composable：播放模式（顺序/列表循环/单曲循环/随机）与上下曲切换调度。
 * 从 PlayerView.vue 提取（2026-08）。
 */
import { ref, computed, type Ref } from 'vue';
import { Repeat, Repeat1, Shuffle } from 'lucide-vue-next';
import type { PlayerEntry, PlayMode } from '@/views/Player/types';

const PLAY_MODES: PlayMode[] = ['sequential', 'repeat-all', 'repeat-one', 'shuffle'];

export function usePlaybackQueue(deps: {
  files: Ref<PlayerEntry[]>;
  currentIndex: Ref<number>;
  playFile: (index: number) => void;
  /** 单曲循环时重播当前文件 */
  replayCurrent: () => void;
}) {
  const playMode = ref<PlayMode>('sequential');

  function cyclePlayMode(): void {
    const idx = PLAY_MODES.indexOf(playMode.value);
    playMode.value = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
  }

  const playModeLabel = computed((): string => {
    switch (playMode.value) {
      case 'repeat-all':
        return '列表循环';
      case 'repeat-one':
        return '单曲循环';
      case 'shuffle':
        return '随机播放';
      default:
        return '顺序播放';
    }
  });

  const playModeIcon = computed((): typeof Repeat => {
    switch (playMode.value) {
      case 'repeat-one':
        return Repeat1;
      case 'shuffle':
        return Shuffle;
      default:
        return Repeat;
    }
  });

  const hasNext = computed((): boolean => {
    return deps.currentIndex.value < deps.files.value.length - 1;
  });

  const hasPrev = computed((): boolean => {
    return deps.currentIndex.value > 0;
  });

  const canNext = computed((): boolean => {
    if (playMode.value === 'repeat-all' || playMode.value === 'shuffle') {
      return deps.files.value.length > 1;
    }
    return hasNext.value;
  });

  const canPrev = computed((): boolean => {
    if (playMode.value === 'repeat-all' || playMode.value === 'shuffle') {
      return deps.files.value.length > 1;
    }
    return hasPrev.value;
  });

  function pickShuffleIndex(): number {
    const n = deps.files.value.length;
    if (n <= 1) {
      return n === 1 ? 0 : -1;
    }
    let idx = deps.currentIndex.value;
    while (idx === deps.currentIndex.value) {
      idx = Math.floor(Math.random() * n);
    }
    return idx;
  }

  function playNext(): void {
    if (playMode.value === 'shuffle') {
      const idx = pickShuffleIndex();
      if (idx >= 0) {
        deps.playFile(idx);
      }
      return;
    }
    if (hasNext.value) {
      deps.playFile(deps.currentIndex.value + 1);
    } else if (playMode.value === 'repeat-all' && deps.files.value.length > 0) {
      deps.playFile(0);
    }
  }

  function playPrev(): void {
    if (playMode.value === 'shuffle') {
      const idx = pickShuffleIndex();
      if (idx >= 0) {
        deps.playFile(idx);
      }
      return;
    }
    if (hasPrev.value) {
      deps.playFile(deps.currentIndex.value - 1);
    } else if (playMode.value === 'repeat-all' && deps.files.value.length > 0) {
      deps.playFile(deps.files.value.length - 1);
    }
  }

  function handleEnded(): void {
    if (playMode.value === 'repeat-one') {
      deps.replayCurrent();
      return;
    }
    playNext();
  }

  return {
    playMode,
    playModeLabel,
    playModeIcon,
    hasNext,
    hasPrev,
    canNext,
    canPrev,
    cyclePlayMode,
    playNext,
    playPrev,
    handleEnded
  };
}
