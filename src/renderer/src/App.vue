<script setup lang="ts">
import { RouterView } from 'vue-router'
import SideNav from './components/SideNav.vue'

const handleWindowMinimize = (): void => {
  window.electron?.process?.platform
}
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-bg-primary">
    <SideNav />
    <main class="flex-1 overflow-auto p-6 animate-fade-in">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: all 0.3s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.page-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
