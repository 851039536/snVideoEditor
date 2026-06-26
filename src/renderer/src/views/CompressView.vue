<script setup lang="ts">
import { FileVideo } from 'lucide-vue-next'
</script>

<template>
  <div class="max-w-4xl mx-auto animate-slide-up">
    <header class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
          <FileVideo :size="20" class="text-accent-purple" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频压缩</h1>
      </div>
      <p class="text-text-secondary text-sm">智能压缩视频文件大小，支持多种编码参数</p>
    </header>

    <div class="glass-card p-8 text-center">
      <p class="text-text-secondary">功能开发中，敬请期待...</p>
    </div>
  </div>
</template>
