<script setup lang="ts">
import { Scissors } from 'lucide-vue-next'
</script>

<template>
  <div class="max-w-4xl mx-auto animate-slide-up">
    <header class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <Scissors :size="20" class="text-accent-blue" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频分割与合并</h1>
      </div>
      <p class="text-text-secondary text-sm">精确切割视频片段，或多视频无缝拼接</p>
    </header>

    <div class="glass-card p-8 text-center">
      <p class="text-text-secondary">功能开发中，敬请期待...</p>
    </div>
  </div>
</template>
