// 变速实时预览：利用 video 元素原生 playbackRate 播放选中区间，无需 ffmpeg 处理
import { ref } from 'vue'
import type { Ref } from 'vue'

// ─── 模块级持久状态：切换页面再返回时预览状态仍可控 ────────

/** 是否正在预览变速效果 */
const isPreviewing = ref(false)

/** 预览状态提示文字（如"正在预览 1.50x 变速效果..."） */
const previewLabel = ref('')

/** 预览自动停止点（source-time，到达时自动停止） */
let previewEndSec = 0

/** 安全超时句柄（兜底停止，防止 onTimeUpdate 不触发） */
let previewTimer: ReturnType<typeof setTimeout> | null = null

/** 控制器：由 SplitMergeView 注册，提供 video 元素访问能力 */
interface SpeedPreviewController {
  getVideoPlayer: () => HTMLVideoElement | null
  setCurrentTime: (t: number) => void
}

let controller: SpeedPreviewController | null = null

/** 重置预览状态（不操作 video 元素） */
function resetState(): void {
  isPreviewing.value = false
  previewLabel.value = ''
  previewEndSec = 0
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
}

/** 注册预览控制器（由持有 videoPlayer 的组件调用） */
export function registerSpeedPreviewController(c: SpeedPreviewController): void {
  controller = c
}

/** 注销预览控制器（卸载时调用，内部先停止预览恢复 playbackRate） */
export function unregisterSpeedPreviewController(): void {
  stopSpeedPreview()
  controller = null
}

/**
 * 开始变速预览：定位到区间起点、按倍率播放 3-5 秒后自动恢复
 * @param start 区间起点（秒）
 * @param duration 区间时长（秒）
 * @param speed 变速倍率（0.25~4）
 */
export function startSpeedPreview(start: number, duration: number, speed: number): void {
  const vp = controller?.getVideoPlayer()
  if (!vp) { return }

  // 清理上次预览（恢复 playbackRate）
  stopSpeedPreview()

  // 定位到区间起点
  vp.currentTime = start
  controller!.setCurrentTime(start)

  // 设置变速倍率
  vp.playbackRate = speed

  // 预览时长：最多 5 秒源时间
  const previewDur = Math.min(Math.max(duration, 0.1), 5)
  previewEndSec = start + previewDur

  // 开始播放，成功后设置预览状态
  vp.play().then(() => {
    isPreviewing.value = true
    previewLabel.value = `正在预览 ${speed.toFixed(2)}x 变速效果...`
  }).catch(() => {
    // 自动播放策略阻止或解码失败，静默重置
    resetState()
  })

  // 安全超时：真实播放时间 = previewDur / speed，加 1s 缓冲
  const realTimeMs = (previewDur / Math.max(speed, 0.1)) * 1000 + 1000
  if (previewTimer) { clearTimeout(previewTimer) }
  previewTimer = setTimeout(() => stopSpeedPreview(), realTimeMs)
}

/** 停止变速预览：暂停播放、恢复 playbackRate=1.0 */
export function stopSpeedPreview(): void {
  const vp = controller?.getVideoPlayer()
  if (vp) {
    vp.pause()
    vp.playbackRate = 1.0
  }
  resetState()
}

/**
 * 检查预览是否应自动停止（供 SplitMergeView 的 onTimeUpdate 调用）
 * @param currentTime 当前播放时间
 * @returns true=预览进行中（跳过 trim 自动停止逻辑）；false=预览未激活（继续走 trim 逻辑）
 */
export function checkSpeedPreviewStop(currentTime: number): boolean {
  if (!isPreviewing.value) { return false }
  if (currentTime >= previewEndSec) {
    stopSpeedPreview()
    return true
  }
  return true
}

/** useSpeedPreview：供 SpeedPanel 等组件解构使用 */
export function useSpeedPreview(): {
  isPreviewing: Ref<boolean>
  previewLabel: Ref<string>
  startSpeedPreview: (start: number, duration: number, speed: number) => void
  stopSpeedPreview: () => void
} {
  return {
    isPreviewing,
    previewLabel,
    startSpeedPreview,
    stopSpeedPreview
  }
}
