<script setup lang="ts">
import { Shield } from 'lucide-vue-next'
</script>

<template>
  <div class="max-w-4xl mx-auto animate-slide-up">
    <header class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
          <Shield :size="20" class="text-success" />
        </div>
        <h1 class="text-2xl font-bold text-text-primary">视频加密与解密</h1>
      </div>
      <p class="text-text-secondary text-sm">AES-256 军用级加密保护您的视频文件</p>
    </header>

    <div class="glass-card p-8 text-center">
      <p class="text-text-secondary">功能开发中，敬请期待...</p>
    </div>
  </div>
</template>
