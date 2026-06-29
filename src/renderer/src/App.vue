<script setup lang="ts">
import { RouterView } from 'vue-router'
import SideNav from './components/SideNav.vue'
import TitleBar from './components/TitleBar.vue'
</script>

<template>
  <div class="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary">
    <TitleBar />
    <div class="flex flex-1 overflow-hidden">
      <SideNav />
      <main class="flex-1 overflow-auto p-4 animate-fade-in">
        <RouterView v-slot="{ Component, route }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: all 0.12s ease;
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
