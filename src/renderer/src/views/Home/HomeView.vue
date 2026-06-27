<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Scissors, FileVideo, Shield, ArrowRight } from 'lucide-vue-next'

const router = useRouter()

interface FeatureCard {
  title: string
  description: string
  path: string
  icon: typeof Scissors
  gradient: string
  features: string[]
}

const cards: FeatureCard[] = [
  {
    title: '视频分割与合并',
    description: '精确切割视频片段，或将多个视频无缝拼接为一个完整作品。',
    path: '/split-merge',
    icon: Scissors,
    gradient: 'from-blue-500/20 to-cyan-500/20',
    features: ['按时间点精确分割', '多视频无缝合并', '拖拽排序管理']
  },
  {
    title: '视频压缩',
    description: '智能压缩视频文件大小，支持多种编码格式和自定义参数。',
    path: '/compress',
    icon: FileVideo,
    gradient: 'from-purple-500/20 to-pink-500/20',
    features: ['多级压缩预设', '自定义码率/分辨率', '批量处理支持']
  },
  {
    title: '视频加密与解密',
    description: 'AES-256 军用级加密保护您的视频文件，安全可靠。',
    path: '/encrypt',
    icon: Shield,
    gradient: 'from-emerald-500/20 to-teal-500/20',
    features: ['AES-256-CTR 加密', '流式处理大文件', '密码强度检测']
  }
]
</script>

<template>
  <div class="max-w-5xl mx-auto animate-slide-up">
    <!-- Hero Section -->
    <div class="text-center mb-12 pt-4">
      <div class="inline-flex items-center gap-3 mb-4">
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center shadow-lg shadow-purple-500/20">
          <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      </div>
      <h1 class="text-3xl font-bold text-text-primary mb-3">
        <span class="text-gradient">SN Video Editor</span>
      </h1>
      <p class="text-text-secondary text-base max-w-md mx-auto leading-relaxed">
        专业的模块化视频编辑工具，简洁高效，安全可靠
      </p>
    </div>

    <!-- Feature Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <button
        v-for="card in cards"
        :key="card.path"
        @click="router.push(card.path)"
        class="glass-card p-6 text-left cursor-pointer relative overflow-hidden"
      >
        <!-- Background Gradient -->
        <div 
          class="absolute inset-0 opacity-0 bg-gradient-to-br"
          :class="card.gradient"
        />

        <!-- Content -->
        <div class="relative z-10">
          <div class="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center mb-4">
            <component :is="card.icon" :size="24" class="text-accent-blue" />
          </div>
          
          <h3 class="text-lg font-semibold text-text-primary mb-2">
            {{ card.title }}
          </h3>
          
          <p class="text-text-secondary text-sm mb-4 leading-relaxed">
            {{ card.description }}
          </p>

          <!-- Feature Tags -->
          <div class="flex flex-wrap gap-2 mb-4">
            <span
              v-for="feat in card.features"
              :key="feat"
              class="text-xs px-2 py-1 rounded-md bg-bg-tertiary text-text-secondary"
            >
              {{ feat }}
            </span>
          </div>

          <!-- Action -->
          <div class="flex items-center gap-2 text-accent-blue">
            <span class="text-sm font-medium">开始使用</span>
            <ArrowRight :size="16" />
          </div>
        </div>
      </button>
    </div>

    <!-- Status Bar -->
    <div class="mt-8 p-4 rounded-xl bg-bg-secondary border border-bg-tertiary flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 rounded-full bg-success animate-pulse" />
        <span class="text-sm text-text-secondary">FFmpeg 引擎就绪</span>
      </div>
      <span class="text-xs text-text-muted">SN Video Editor v1.0.0</span>
    </div>
  </div>
</template>
