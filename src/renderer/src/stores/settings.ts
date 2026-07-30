// 应用设置 store：主题、压缩预设、播放器数据、输出目录、侧栏状态的 localStorage 持久化
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { PersistedPlayerData } from '@/views/Player/types'
import { DEFAULT_PLAYER_DATA } from '@/views/Player/types'
import type { WebPageEntry } from '@/views/Download/types'

const THEME_KEY = 'snve-theme'
const COMPRESS_PRESET_KEY = 'snve-compress-preset'
const PLAYER_DATA_KEY = 'snve-player-data'
const OUTPUT_DIR_KEY = 'snve-output-dir'
const SIDEBAR_COLLAPSED_KEY = 'snve-sidebar-collapsed'
const WEB_PAGE_PATHS_KEY = 'snve-web-page-paths'

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

function loadWebPagePaths(): WebPageEntry[] {
  try {
    const saved = localStorage.getItem(WEB_PAGE_PATHS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) { return parsed }
    }
  } catch { /* ignore */ }
  return []
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export const useSettingsStore = defineStore('settings', () => {
  const outputDirectory = ref<string>(loadOutputDir())
  const theme = ref<'dark' | 'light'>(loadTheme())
  const compressPreset = ref<CompressPreset>(loadCompressPreset())
  const playerData = ref<PersistedPlayerData>(loadPlayerData())
  const sidebarCollapsed = ref<boolean>(loadSidebarCollapsed())
  const webPagePaths = ref<WebPageEntry[]>(loadWebPagePaths())

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

  /** 新增网页路径条目 */
  function addWebPagePath(url: string): void {
    webPagePaths.value.push({
      id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      createdAt: Date.now()
    })
  }

  /** 修改指定网页路径条目的 URL */
  function updateWebPagePath(id: string, url: string): void {
    const entry = webPagePaths.value.find((e) => e.id === id)
    if (entry) {
      entry.url = url
    }
  }

  /** 删除指定网页路径条目 */
  function removeWebPagePath(id: string): void {
    webPagePaths.value = webPagePaths.value.filter((e) => e.id !== id)
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

  // 持久化播放器数据
  watch(playerData, (val) => {
    try { localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  // 持久化侧栏折叠状态
  watch(sidebarCollapsed, (val) => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(val)) } catch { /* ignore */ }
  })

  // 持久化网页路径列表
  watch(webPagePaths, (val) => {
    try { localStorage.setItem(WEB_PAGE_PATHS_KEY, JSON.stringify(val)) } catch { /* ignore */ }
  }, { deep: true })

  return {
    outputDirectory,
    theme,
    compressPreset,
    playerData,
    sidebarCollapsed,
    webPagePaths,
    setOutputDirectory,
    toggleTheme,
    setCompressPreset,
    setPlayerData,
    toggleSidebar,
    addWebPagePath,
    updateWebPagePath,
    removeWebPagePath
  }
})
