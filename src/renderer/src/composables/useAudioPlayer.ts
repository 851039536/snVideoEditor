// 音频播放器组合式函数
import { ref } from 'vue'
import type { Ref } from 'vue'

export interface UseAudioPlayerOptions {
  /** 当前时间更新回调，可用于裁切区间自动停止 */
  onTimeUpdate?: (currentTime: number, ap: HTMLAudioElement) => void
  /** 音频元数据加载完成回调 */
  onLoaded?: (ap: HTMLAudioElement) => void
  /** 音频加载错误回调 */
  onError?: (e: Event) => void
}

export function useAudioPlayer(options?: UseAudioPlayerOptions): {
  audioPlayer: Ref<HTMLAudioElement | null>
  isPlaying: Ref<boolean>
  currentTime: Ref<number>
  togglePlay: () => Promise<void>
  onAudioPlay: () => void
  onAudioStop: () => void
  onTimeUpdate: () => void
  onAudioError: (e: Event) => void
  onAudioLoaded: () => void
  seekAudioPlayer: (t: number) => void
} {
  const audioPlayer = ref<HTMLAudioElement | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)

  async function togglePlay(): Promise<void> {
    const ap = audioPlayer.value
    if (!ap) { return }
    if (ap.paused) {
      try { await ap.play() } catch (_e) { /* ignore */ }
    } else {
      ap.pause()
    }
  }

  function onAudioPlay(): void { isPlaying.value = true }
  function onAudioStop(): void { isPlaying.value = false }

  function onTimeUpdate(): void {
    const ap = audioPlayer.value
    if (!ap) { return }
    currentTime.value = ap.currentTime
    options?.onTimeUpdate?.(currentTime.value, ap)
  }

  function onAudioError(e: Event): void {
    if (options?.onError) {
      options.onError(e)
    } else {
      const audio = e.target as HTMLAudioElement
      console.error('音频加载失败:', audio?.error?.message)
    }
  }

  function onAudioLoaded(): void {
    const ap = audioPlayer.value
    if (!ap) { return }
    if (options?.onLoaded) {
      options.onLoaded(ap)
    } else {
      ap.currentTime = 0
      currentTime.value = 0
    }
  }

  function seekAudioPlayer(t: number): void {
    if (audioPlayer.value) {
      audioPlayer.value.currentTime = t
      currentTime.value = t
    }
  }

  return {
    audioPlayer,
    isPlaying,
    currentTime,
    togglePlay,
    onAudioPlay,
    onAudioStop,
    onTimeUpdate,
    onAudioError,
    onAudioLoaded,
    seekAudioPlayer
  }
}
