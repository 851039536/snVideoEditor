/**
 * Screenshot & marker management composable for PlayerView.
 * Extracted from PlayerView.vue (2026-06-30).
 */
import { ref, computed, type Ref } from 'vue'
import { secondsToHMS, parseTimeInput } from '@/utils/time'
import type { PlayerEntry, ScreenshotMarker, ThumbnailData } from '@/views/Player/types'

// Pre-compiled regexes
const EXT_RE = /\.[^.]+$/
const COLON_RE = /:/g
const DIR_SEP_RE = /[/\\][^/\\]+$/

export function useScreenshot(deps: {
  currentFile: Ref<PlayerEntry | null>
  currentFileName: Ref<string>
  playerRef: Ref<unknown>  // Plyr instance (any to avoid tight coupling)
  errorMsg: Ref<string>
  screenshotMarkers: Ref<ScreenshotMarker[]>
  saveToStore: () => void
  generateThumbnailsIfNeeded: () => Promise<void>
  thumbnailData: Ref<ThumbnailData | null>
}) {
  const showScreenshotModal = ref(false)
  const screenshotTimeInput = ref('')
  const batchInterval = ref(10)
  const capturing = ref(false)
  const captureProgress = ref({ current: 0, total: 0 })
  const screenshotMode = ref<'current' | 'custom' | 'batch'>('current')

  // Helper: get actual input path (decrypted temp or original)
  function getScreenshotInputPath(): string {
    const cf = deps.currentFile.value
    if (!cf) { return '' }
    if (cf.isEncrypted && cf.tempPath) { return cf.tempPath }
    if (!cf.isEncrypted) { return cf.path }
    return ''
  }

  function getScreenshotBasePath(): string {
    const name = deps.currentFileName.value.replace(EXT_RE, '')
    const dir = deps.currentFile.value?.path.replace(DIR_SEP_RE, '') || ''
    return `${dir}/${name}`
  }

  async function doCapture(timeSec: number, outputPath: string): Promise<boolean> {
    const input = getScreenshotInputPath()
    if (!input) { return false }
    return window.electronAPI.captureScreenshot({ input, output: outputPath, time: timeSec })
  }

  async function doSingleCapture(timeSec: number): Promise<void> {
    capturing.value = true
    try {
      const timeStr = new Date().toTimeString().slice(0, 8).replace(COLON_RE, '-')
      const output = `${getScreenshotBasePath()}_screenshot_${timeStr}.png`
      const ok = await doCapture(timeSec, output)
      if (ok) {
        addMarker(timeSec)
        deps.saveToStore()
      }
    } catch (e) {
      deps.errorMsg.value = `截图失败: ${e}`
    } finally {
      capturing.value = false
      showScreenshotModal.value = false
    }
  }

  async function captureCurrentFrame(): Promise<void> {
    const player = deps.playerRef.value as { currentTime?: number } | null
    if (!player || capturing.value) { return }
    const t = player.currentTime || 0
    await doSingleCapture(t)
  }

  async function captureByTime(): Promise<void> {
    if (!screenshotTimeInput.value || capturing.value) { return }
    const timeSec = parseTimeInput(screenshotTimeInput.value)
    if (timeSec < 0) { return }
    await doSingleCapture(timeSec)
  }

  async function batchCapture(): Promise<void> {
    const dur = deps.currentFile.value?.meta?.duration
    if (!dur || !batchInterval.value || batchInterval.value < 1 || capturing.value) { return }

    const total = Math.floor(dur / batchInterval.value)
    if (total === 0) { return }

    capturing.value = true
    captureProgress.value = { current: 0, total }

    for (let i = 0; i < total; i++) {
      captureProgress.value.current = i + 1
      const timeSec = i * batchInterval.value
      const padded = String(i + 1).padStart(Math.max(3, String(total).length), '0')
      const output = `${getScreenshotBasePath()}_frame_${padded}.png`
      try {
        const ok = await doCapture(timeSec, output)
        if (ok) { addMarker(timeSec) }
      } catch {
        // continue to next
      }
    }

    capturing.value = false
    showScreenshotModal.value = false
  }

  function openScreenshotModal(): void {
    if (!deps.currentFile.value) { return }
    const encrypted = deps.currentFile.value.isEncrypted
    if (encrypted && !deps.currentFile.value.tempPath) {
      deps.errorMsg.value = '请先播放加密视频完成解密后再截图'
      return
    }
    screenshotMode.value = 'current'
    screenshotTimeInput.value = ''
    batchInterval.value = 10
    captureProgress.value = { current: 0, total: 0 }
    showScreenshotModal.value = true
  }

  function closeScreenshotModal(): void {
    if (!capturing.value) {
      showScreenshotModal.value = false
    }
  }

  // ---- Marker management ----
  function addMarker(timeSec: number, labelPrefix = '截图'): void {
    const rounded = Math.round(timeSec)
    if (deps.screenshotMarkers.value.some((m) => Math.abs(m.time - rounded) < 1)) { return }
    const label = `${labelPrefix} ${deps.screenshotMarkers.value.length + 1}`
    deps.screenshotMarkers.value.push({ time: rounded, label })
    renderMarkers()
  }

  function addCurrentMarker(): void {
    const player = deps.playerRef.value as { currentTime?: number } | null
    if (!player) { return }
    const t = player.currentTime || 0
    addMarker(t, '标记')
    deps.saveToStore()
  }

  function removeMarkerByIndex(index: number): void {
    deps.screenshotMarkers.value.splice(index, 1)
    renderMarkers()
    deps.saveToStore()
  }

  function clearAllMarkers(): void {
    deps.screenshotMarkers.value = []
    renderMarkers()
    deps.saveToStore()
  }

  /** Manually inject marker DOM elements into Plyr's progress bar */
  function renderMarkers(): void {
    const player = deps.playerRef.value as {
      elements?: { progress?: HTMLElement },
      currentTime?: number
    } | null
    if (!player) { return }
    const dur = deps.currentFile.value?.meta?.duration
    if (!dur || dur <= 0) { return }

    const progressEl = player.elements?.progress as HTMLElement | null
    if (!progressEl) { return }

    // Remove existing markers
    progressEl.querySelectorAll('.plyr__progress__marker').forEach((el) => el.remove())

    for (let i = 0; i < deps.screenshotMarkers.value.length; i++) {
      const m = deps.screenshotMarkers.value[i]
      const pct = (m.time / dur) * 100
      if (pct < 0 || pct > 100) { continue }
      const span = document.createElement('span')
      span.className = 'plyr__progress__marker'
      span.setAttribute('data-time', String(m.time))
      span.setAttribute('data-label', m.label)
      span.style.left = pct + '%'
      span.title = m.label + ' (' + secondsToHMS(m.time) + ') — 右键删除'
      span.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        removeMarkerByIndex(i)
      })
      progressEl.appendChild(span)
    }
  }

  return {
    // State
    showScreenshotModal,
    screenshotTimeInput,
    batchInterval,
    capturing,
    captureProgress,
    screenshotMode,
    // Helpers
    getScreenshotInputPath,
    getScreenshotBasePath,
    // Actions
    openScreenshotModal,
    closeScreenshotModal,
    captureCurrentFrame,
    captureByTime,
    batchCapture,
    doSingleCapture,
    // Markers
    addMarker,
    addCurrentMarker,
    removeMarkerByIndex,
    clearAllMarkers,
    renderMarkers
  }
}
