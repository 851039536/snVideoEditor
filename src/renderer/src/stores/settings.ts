import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const THEME_KEY = 'snve-theme'
const COMPRESS_PRESET_KEY = 'snve-compress-preset'

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

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export const useSettingsStore = defineStore('settings', () => {
  const outputDirectory = ref<string>('')
  const lastPassword = ref<string>('')
  const theme = ref<'dark' | 'light'>(loadTheme())
  const compressPreset = ref<CompressPreset>(loadCompressPreset())

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

  // Persist theme and apply to DOM
  watch(theme, (val) => {
    try { localStorage.setItem(THEME_KEY, val) } catch { /* ignore */ }
    applyTheme(val)
  }, { immediate: true })

  // Persist compress preset
  watch(compressPreset, (val) => {
    try { localStorage.setItem(COMPRESS_PRESET_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  return {
    outputDirectory,
    lastPassword,
    theme,
    compressPreset,
    setOutputDirectory,
    setLastPassword,
    toggleTheme,
    setCompressPreset
  }
})
