import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { PersistedPlayerData } from '@/views/Player/types'
import { DEFAULT_PLAYER_DATA } from '@/views/Player/types'

const THEME_KEY = 'snve-theme'
const COMPRESS_PRESET_KEY = 'snve-compress-preset'
const PLAYER_DATA_KEY = 'snve-player-data'

export interface CompressPreset {
  crfValue: number
  resolution: string
  bitrate: string
  codec: string
  audioBitrate: string
  preset: string
  twoPass: boolean
}

const DEFAULT_COMPRESS_PRESET: CompressPreset = {
  crfValue: 23,
  resolution: 'original',
  bitrate: '',
  codec: 'libx264',
  audioBitrate: '32k',
  preset: 'fast',
  twoPass: false
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

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export const useSettingsStore = defineStore('settings', () => {
  const outputDirectory = ref<string>('')
  const lastPassword = ref<string>('')
  const theme = ref<'dark' | 'light'>(loadTheme())
  const compressPreset = ref<CompressPreset>(loadCompressPreset())
  const playerData = ref<PersistedPlayerData>(loadPlayerData())

  // Apply theme on init
  applyTheme(theme.value)

  function setOutputDirectory(dir: string): void {
    outputDirectory.value = dir
  }

  function setLastPassword(password: string): void {
    lastPassword.value = password
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

  // Persist theme and apply to DOM
  watch(theme, (val) => {
    try { localStorage.setItem(THEME_KEY, val) } catch { /* ignore */ }
    applyTheme(val)
  }, { immediate: true })

  // Persist compress preset
  watch(compressPreset, (val) => {
    try { localStorage.setItem(COMPRESS_PRESET_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  // Persist player data
  watch(playerData, (val) => {
    try { localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  return {
    outputDirectory,
    lastPassword,
    theme,
    compressPreset,
    playerData,
    setOutputDirectory,
    setLastPassword,
    toggleTheme,
    setCompressPreset,
    setPlayerData
  }
})
