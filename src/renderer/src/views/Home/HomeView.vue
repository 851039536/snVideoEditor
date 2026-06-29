<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Scissors, FileVideo, Shield, Image, Globe, Play } from 'lucide-vue-next'

const router = useRouter()

interface FeatureCard {
  title: string
  desc: string
  path: string
  icon: typeof Scissors
  gradient: string
}

const cards: FeatureCard[] = [
  { title: '视频分割与合并', desc: '精确切割与无缝拼接', path: '/split-merge', icon: Scissors, gradient: 'from-blue-500/20 to-cyan-500/20' },
  { title: '视频压缩', desc: '智能压缩，多种编码格式', path: '/compress', icon: FileVideo, gradient: 'from-purple-500/20 to-pink-500/20' },
  { title: '视频下载', desc: 'm3u8 流媒体下载为 MP4', path: '/download', icon: Globe, gradient: 'from-cyan-500/20 to-blue-500/20' },
  { title: '视频加密与解密', desc: 'AES-256 加密保护视频', path: '/encrypt', icon: Shield, gradient: 'from-emerald-500/20 to-teal-500/20' },
  { title: '视频转 GIF', desc: '视频片段转高质量动图', path: '/gif', icon: Image, gradient: 'from-orange-500/20 to-yellow-500/20' },
  { title: '视频播放器', desc: '播放普通与加密视频', path: '/player', icon: Play, gradient: 'from-red-500/20 to-orange-500/20' }
]
</script>

<template>
  <div class="max-w-4xl mx-auto animate-slide-up">
    <!-- Hero -->
    <div class="text-center mb-8 pt-6">
      <div class="inline-flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center shadow-lg shadow-purple-500/20">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      </div>
      <h1 class="text-2xl font-bold text-text-primary mb-1">
        <span class="text-gradient">SN Video Editor</span>
      </h1>
      <p class="text-text-secondary text-sm">模块化视频编辑工具</p>
    </div>

    <!-- Feature Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button
        v-for="card in cards"
        :key="card.path"
        @click="router.push(card.path)"
        class="glass-card p-5 text-left cursor-pointer group hover:border-accent-blue/30 transition-all relative overflow-hidden"
      >
        <div
          class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br"
          :class="card.gradient"
        />
        <div class="relative z-10 flex items-center gap-4">
          <div class="w-11 h-11 rounded-xl bg-bg-tertiary flex items-center justify-center flex-shrink-0">
            <component :is="card.icon" :size="22" class="text-accent-blue" />
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-text-primary">{{ card.title }}</h3>
            <p class="text-xs text-text-muted mt-0.5">{{ card.desc }}</p>
          </div>
        </div>
      </button>
    </div>

    <!-- Footer -->
    <p class="text-center text-xs text-text-muted mt-8">SN Video Editor v1.0.0</p>
  </div>
</template>
