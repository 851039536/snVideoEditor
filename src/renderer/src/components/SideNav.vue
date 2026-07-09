<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Video, Sun, Moon } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { FEATURE_CONFIG } from '@/config/features'

const router = useRouter()
const settingsStore = useSettingsStore()
const hoverExpanded = ref(false)

const isActive = (path: string): boolean => {
  return router.currentRoute.value.path === path
}

const toggleCollapsed = (): void => {
  settingsStore.toggleSidebar()
  hoverExpanded.value = false
}

const isExpanded = computed((): boolean => {
  return !settingsStore.sidebarCollapsed || hoverExpanded.value
})
</script>

<template>
  <nav
    class="h-full bg-bg-secondary border-r border-bg-tertiary flex flex-col flex-shrink-0 z-10 side-nav"
    :class="isExpanded ? 'nav-expanded' : 'nav-collapsed'"
    @mouseenter="hoverExpanded = true"
    @mouseleave="hoverExpanded = false"
  >
    <!-- Logo Header -->
    <div class="nav-logo h-14 flex items-center justify-center border-b border-bg-tertiary overflow-hidden px-2">
      <div class="flex items-center">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center flex-shrink-0">
          <Video :size="16" class="text-white" />
        </div>
        <span class="nav-text text-sm font-bold text-gradient">
          SN Video Editor
        </span>
      </div>
    </div>

    <!-- Nav Items -->
    <div class="flex-1 flex flex-col gap-1 p-2 mt-2 overflow-hidden">
      <button
        v-for="item in FEATURE_CONFIG"
        :key="item.path"
        @click="router.push(item.path)"
        class="nav-item flex items-center px-3 py-2.5 rounded-lg relative"
        :class="isActive(item.path) ? 'active' : ''"
        :title="!isExpanded ? item.name : undefined"
      >
        <component
          :is="item.icon"
          :size="20"
          class="flex-shrink-0"
          :class="isActive(item.path) ? '' : 'text-text-secondary'"
          :style="isActive(item.path) ? { color: item.color } : undefined"
        />
        <span
          class="nav-text text-sm"
          :class="isActive(item.path) ? 'text-text-primary' : 'text-text-secondary'"
        >
          {{ item.name }}
        </span>
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
        :title="settingsStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
      >
        <component
          :is="settingsStore.sidebarCollapsed ? ChevronRight : ChevronLeft"
          :size="18"
          class="text-text-secondary"
        />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.side-nav {
  width: 12.5rem;
  transition: width var(--transition-normal);
}

.side-nav.nav-collapsed {
  width: 4rem;
}

.nav-item {
  position: relative;
  overflow: hidden;
}

.nav-item.active {
  background: hsl(var(--primary) / 0.1);
}

/* Text slide animation */
.nav-text {
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  max-width: 10rem;
  opacity: 1;
  margin-left: 0.75rem;
  transition:
    max-width var(--transition-normal),
    opacity var(--transition-normal),
    margin-left var(--transition-normal);
}

/* Logo header text — smaller margin */
.nav-logo .nav-text {
  margin-left: 0.5rem;
  max-width: 9rem;
}

/* Collapsed state — must come after .nav-logo override for specificity */
.nav-collapsed .nav-text {
  max-width: 0;
  opacity: 0;
  margin-left: 0;
}
</style>
