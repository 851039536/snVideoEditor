import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

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
  const lastPassword = ref<string>('')
  const theme = ref<'dark' | 'light'>(loadTheme())

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

  // Persist theme and apply to DOM
  watch(theme, (val) => {
    try { localStorage.setItem(THEME_KEY, val) } catch { /* ignore */ }
    applyTheme(val)
  }, { immediate: true })

  return {
    outputDirectory,
    lastPassword,
    theme,
    setOutputDirectory,
    setLastPassword,
    toggleTheme
  }
})
