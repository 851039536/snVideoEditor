// 应用设置 store：主题、压缩预设、GIF 参数、播放器数据、输出目录、侧栏状态的 localStorage 持久化
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { PersistedPlayerData } from '@/views/Player/types'
import { DEFAULT_PLAYER_DATA } from '@/views/Player/types'

const THEME_KEY = 'snve-theme'
const COMPRESS_PRESET_KEY = 'snve-compress-preset'
const GIF_SETTINGS_KEY = 'snve-gif-settings'
const PLAYER_DATA_KEY = 'snve-player-data'
const OUTPUT_DIR_KEY = 'snve-output-dir'
const SIDEBAR_COLLAPSED_KEY = 'snve-sidebar-collapsed'

export interface CompressPreset {
  crfValue: number
  resolution: string
  bitrate: string
  codec: string
  audioBitrate: string
  preset: string
  nvencPreset: string
  twoPass: boolean
}

const DEFAULT_COMPRESS_PRESET: CompressPreset = {
  crfValue: 23,
  resolution: 'original',
  bitrate: '',
  codec: 'libx264',
  audioBitrate: '32k',
  preset: 'fast',
  nvencPreset: 'p4',
  twoPass: false
}

export interface GifSettings {
  quality: 'high' | 'medium' | 'low'
  fps: number
  width: string
  loop: number
  speed: number
}

const DEFAULT_GIF_SETTINGS: GifSettings = {
  quality: 'medium',
  fps: 10,
  width: '480',
  loop: 0,
  speed: 1
}

function loadTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') { return saved }
  } catch { /* ignore */ }
  return 'dark'
}

function loadCompressPreset(): CompressPreset {
  try {
    const saved = localStorage.getItem(COMPRESS_PRESET_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return { ...DEFAULT_COMPRESS_PRESET, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_COMPRESS_PRESET }
}

function loadPlayerData(): PersistedPlayerData {
  try {
    const saved = localStorage.getItem(PLAYER_DATA_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return { ...DEFAULT_PLAYER_DATA, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PLAYER_DATA }
}

function loadGifSettings(): GifSettings {
  try {
    const saved = localStorage.getItem(GIF_SETTINGS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const merged: GifSettings = { ...DEFAULT_GIF_SETTINGS, ...parsed }
      // 字段合法性校验，避免脏数据破坏页面
      if (merged.quality !== 'high' && merged.quality !== 'medium' && merged.quality !== 'low') {
        merged.quality = 'medium'
      }
      if (typeof merged.fps !== 'number' || !Number.isFinite(merged.fps)) {
        merged.fps = 10
      } else {
        merged.fps = Math.min(Math.max(Math.round(merged.fps), 5), 30)
      }
      if (typeof merged.width !== 'string') { merged.width = '480' }
      if (typeof merged.loop !== 'number' || merged.loop < 0) { merged.loop = 0 }
      if (typeof merged.speed !== 'number' || merged.speed <= 0) { merged.speed = 1 }
      return merged
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_GIF_SETTINGS }
}

function loadOutputDir(): string {
  try {
    return localStorage.getItem(OUTPUT_DIR_KEY) || ''
  } catch { return '' }
}

function loadSidebarCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (saved !== null) { return saved === 'true' }
  } catch { /* ignore */ }
  return false
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export const useSettingsStore = defineStore('settings', () => {
  const outputDirectory = ref<string>(loadOutputDir())
  const theme = ref<'dark' | 'light'>(loadTheme())
  const compressPreset = ref<CompressPreset>(loadCompressPreset())
  const gifSettings = ref<GifSettings>(loadGifSettings())
  const playerData = ref<PersistedPlayerData>(loadPlayerData())
  const sidebarCollapsed = ref<boolean>(loadSidebarCollapsed())

  function setOutputDirectory(dir: string): void {
    outputDirectory.value = dir
  }

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setCompressPreset(preset: CompressPreset): void {
    compressPreset.value = preset
  }

  function setPlayerData(data: PersistedPlayerData): void {
    playerData.value = data
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  // 持久化输出目录
  watch(outputDirectory, (val) => {
    try { localStorage.setItem(OUTPUT_DIR_KEY, val) } catch { /* ignore */ }
  })

  // 持久化主题并应用到 DOM
  watch(theme, (val) => {
    try { localStorage.setItem(THEME_KEY, val) } catch { /* ignore */ }
    applyTheme(val)
  }, { immediate: true })

  // 持久化压缩预设
  watch(compressPreset, (val) => {
    try { localStorage.setItem(COMPRESS_PRESET_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  // 持久化 GIF 参数
  watch(gifSettings, (val) => {
    try { localStorage.setItem(GIF_SETTINGS_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  // 持久化播放器数据
  watch(playerData, (val) => {
    try { localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  // 持久化侧栏折叠状态
  watch(sidebarCollapsed, (val) => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(val)) } catch { /* ignore */ }
  })

  return {
    outputDirectory,
    theme,
    compressPreset,
    gifSettings,
    playerData,
    sidebarCollapsed,
    setOutputDirectory,
    toggleTheme,
    setCompressPreset,
    setPlayerData,
    toggleSidebar
  }
})
