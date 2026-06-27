import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface CompressPreset {
  label: string
  crf: number
  description: string
}

const THEME_KEY = 'snve-theme'

function loadTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') { return saved }
  } catch { /* ignore */ }
  return 'dark'
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export const useSettingsStore = defineStore('settings', () => {
  const outputDirectory = ref<string>('')
  const defaultCompressPreset = ref<string>('medium')
  const lastPassword = ref<string>('')
  const theme = ref<'dark' | 'light'>(loadTheme())

  // Apply theme on init
  applyTheme(theme.value)

  const compressPresets: CompressPreset[] = [
    { label: '高质量', crf: 18, description: '最佳画质，文件较大' },
    { label: '中等质量', crf: 23, description: '画质与大小平衡' },
    { label: '低质量', crf: 28, description: '最小文件，画质降低' },
    { label: '极致压缩', crf: 32, description: '最小体积，画质明显下降' }
  ]

  function setOutputDirectory(dir: string): void {
    outputDirectory.value = dir
  }

  function setCompressPreset(preset: string): void {
    defaultCompressPreset.value = preset
  }

  function getPresetByLabel(label: string): CompressPreset | undefined {
    return compressPresets.find((p) => p.label === label)
  }

  function setLastPassword(password: string): void {
    lastPassword.value = password
  }

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  // Persist theme and apply to DOM
  watch(theme, (val) => {
    try { localStorage.setItem(THEME_KEY, val) } catch { /* ignore */ }
    applyTheme(val)
  }, { immediate: true })

  return {
    outputDirectory,
    defaultCompressPreset,
    lastPassword,
    theme,
    compressPresets,
    setOutputDirectory,
    setCompressPreset,
    getPresetByLabel,
    setLastPassword,
    toggleTheme
  }
})
