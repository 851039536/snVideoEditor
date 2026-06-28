<script setup lang="ts">
import { useRouter } from 'vue-router'
import {
  Home, Scissors, FileVideo, Shield, Image, Globe,
  ChevronLeft, ChevronRight, Video, Sun, Moon
} from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settingsStore = useSettingsStore()
const collapsed = ref(false)

interface NavItem {
  name: string
  path: string
  icon: typeof Home
  color: string
}

const navItems: NavItem[] = [
  { name: '首页', path: '/', icon: Home, color: '#E6EDF3' },
  { name: '分割合并', path: '/split-merge', icon: Scissors, color: '#5B8DEF' },
  { name: '视频压缩', path: '/compress', icon: FileVideo, color: '#7C5CFC' },
  { name: '视频下载', path: '/download', icon: Globe, color: '#22D3EE' },
  { name: '加密解密', path: '/encrypt', icon: Shield, color: '#A78BFA' },
  { name: '视频转GIF', path: '/gif', icon: Image, color: '#F0A050' },
  { name: '视频播放', path: '/player', icon: Video, color: '#58A6FF' }
]

const isActive = (path: string): boolean => {
  return router.currentRoute.value.path === path
}

const toggleCollapsed = (): void => {
  collapsed.value = !collapsed.value
}

const navWidth = computed((): string => {
  return collapsed.value ? '4rem' : '12.5rem'
})
</script>

<template>
  <nav 
    class="h-screen bg-bg-secondary border-r border-bg-tertiary flex flex-col transition-all duration-300 flex-shrink-0"
    :style="{ width: navWidth }"
  >
    <!-- Logo Header -->
    <div class="h-14 flex items-center justify-center border-b border-bg-tertiary">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center">
          <Video :size="16" class="text-white" />
        </div>
        <Transition name="fade">
          <span 
            v-if="!collapsed"
            class="text-sm font-bold text-gradient whitespace-nowrap"
          >
            SN Video Editor
          </span>
        </Transition>
      </div>
    </div>

    <!-- Nav Items -->
    <div class="flex-1 flex flex-col gap-1 p-2 mt-2">
      <button
        v-for="item in navItems"
        :key="item.path"
        @click="router.push(item.path)"
        class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg relative"
        :class="isActive(item.path) ? 'active' : ''"
      >
        <component 
          :is="item.icon"
          :size="20"
          class="flex-shrink-0"
          :class="isActive(item.path) ? '' : 'text-text-secondary'"
          :style="isActive(item.path) ? { color: item.color } : undefined"
        />
        <Transition name="fade">
          <span
            v-if="!collapsed"
            class="text-sm whitespace-nowrap"
            :class="isActive(item.path) ? 'text-text-primary' : 'text-text-secondary'"
          >
            {{ item.name }}
          </span>
        </Transition>
        <!-- Active Indicator -->
        <div
          v-if="isActive(item.path)"
          class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full"
          :style="{ backgroundColor: item.color }"
        />
      </button>
    </div>

    <!-- Bottom Actions -->
    <div class="p-2 border-t border-bg-tertiary space-y-1">
      <!-- Theme Toggle -->
      <button
        @click="settingsStore.toggleTheme()"
        class="w-full flex items-center justify-center p-2 rounded-lg"
        :title="settingsStore.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
      >
        <Sun v-if="settingsStore.theme === 'dark'" :size="18" class="text-warning" />
        <Moon v-else :size="18" class="text-accent-purple" />
      </button>
      <!-- Collapse Toggle -->
      <button
        @click="toggleCollapsed"
        class="w-full flex items-center justify-center p-2 rounded-lg"
      >
        <component 
          :is="collapsed ? ChevronRight : ChevronLeft"
          :size="18"
          class="text-text-secondary"
        />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.nav-item {
  position: relative;
  overflow: hidden;
}

.nav-item.active {
  background: hsl(var(--primary) / 0.1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
