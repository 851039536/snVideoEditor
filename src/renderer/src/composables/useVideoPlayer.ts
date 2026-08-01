// 视频播放器状态与播放控制
import { ref } from 'vue'
import type { Ref } from 'vue'

export interface UseVideoPlayerOptions {
  /**
   * Called after currentTime is updated in onTimeUpdate.
   * Use this for trim auto-stop logic etc.
   */
  onTimeUpdate?: (currentTime: number, vp: HTMLVideoElement) => void
  /**
   * Called when video metadata is loaded.
   * Use this to seek to initial position (e.g. trim start).
   */
  onLoaded?: (vp: HTMLVideoElement) => void
  /**
   * Called when the video element encounters an error.
   * Defaults to console.error if not provided.
   */
  onError?: (e: Event) => void
  /**
   * Called when play() rejects (e.g. autoplay policy, decode failure).
   * Defaults to swallowing the error silently.
   */
  onPlayError?: (e: unknown) => void
}

export function useVideoPlayer(options?: UseVideoPlayerOptions): {
  videoPlayer: Ref<HTMLVideoElement | null>
  isPlaying: Ref<boolean>
  currentTime: Ref<number>
  togglePlay: () => Promise<void>
  onVideoPlay: () => void
  onVideoStop: () => void
  onTimeUpdate: () => void
  onVideoError: (e: Event) => void
  onVideoLoaded: () => void
  seekVideoPlayer: (t: number) => void
} {
  const videoPlayer = ref<HTMLVideoElement | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)

  async function togglePlay(): Promise<void> {
    const vp = videoPlayer.value
    if (!vp) { return }
    if (vp.paused) {
      try {
        await vp.play()
      } catch (e) {
        options?.onPlayError?.(e)
      }
    } else {
      vp.pause()
    }
  }

  function onVideoPlay(): void { isPlaying.value = true }
  function onVideoStop(): void { isPlaying.value = false }

  function onTimeUpdate(): void {
    const vp = videoPlayer.value
    if (!vp) { return }
    currentTime.value = vp.currentTime
    options?.onTimeUpdate?.(currentTime.value, vp)
  }

  function onVideoError(e: Event): void {
    if (options?.onError) {
      options.onError(e)
    } else {
      const video = e.target as HTMLVideoElement
      console.error('视频加载失败:', video?.error?.message)
    }
  }

  function onVideoLoaded(): void {
    const vp = videoPlayer.value
    if (!vp) { return }
    if (options?.onLoaded) {
      options.onLoaded(vp)
    } else {
      vp.currentTime = 0
      currentTime.value = 0
    }
  }

  function seekVideoPlayer(t: number): void {
    if (videoPlayer.value) {
      videoPlayer.value.currentTime = t
      currentTime.value = t
    }
  }

  return {
    videoPlayer,
    isPlaying,
    currentTime,
    togglePlay,
    onVideoPlay,
    onVideoStop,
    onTimeUpdate,
    onVideoError,
    onVideoLoaded,
    seekVideoPlayer
  }
}
