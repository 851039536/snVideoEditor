import {
  Home, Scissors, FileVideo, Shield, Image, Globe, Video, AudioLines, Music, Palette
} from 'lucide-vue-next'
import type { Component } from 'vue'

export interface FeatureMeta {
  name: string
  path: string
  icon: Component
  color: string
  desc: string
  gradient: string
}

export const FEATURE_CONFIG: FeatureMeta[] = [
  {
    name: '首页',
    path: '/',
    icon: Home,
    color: 'var(--color-text-primary)',
    desc: '视频编辑工具箱',
    gradient: 'from-accent-blue/10 to-accent-purple/10'
  },
  {
    name: '分割合并',
    path: '/split-merge',
    icon: Scissors,
    color: 'var(--color-accent-blue)',
    desc: '精确切割与无缝拼接',
    gradient: 'from-blue-500/20 to-cyan-500/20'
  },
  {
    name: '音频分割合并',
    path: '/audio-split',
    icon: Music,
    color: 'var(--color-accent-light)',
    desc: '音频精确裁剪与拼接',
    gradient: 'from-green-500/20 to-emerald-500/20'
  },
  {
    name: '视频压缩',
    path: '/compress',
    icon: FileVideo,
    color: 'var(--color-accent-purple)',
    desc: '智能压缩，多种编码格式',
    gradient: 'from-purple-500/20 to-pink-500/20'
  },
  {
    name: '视频下载',
    path: '/download',
    icon: Globe,
    color: 'var(--color-info)',
    desc: 'm3u8 流媒体下载为 MP4',
    gradient: 'from-cyan-500/20 to-blue-500/20'
  },
  {
    name: '加密解密',
    path: '/encrypt',
    icon: Shield,
    color: 'var(--color-accent-light)',
    desc: 'AES-256 加密保护视频',
    gradient: 'from-emerald-500/20 to-teal-500/20'
  },
  {
    name: '视频转GIF',
    path: '/gif',
    icon: Image,
    color: 'var(--color-warning)',
    desc: '视频片段转高质量动图',
    gradient: 'from-orange-500/20 to-yellow-500/20'
  },
  {
    name: '视频播放',
    path: '/player',
    icon: Video,
    color: 'var(--color-info)',
    desc: '播放普通与加密视频',
    gradient: 'from-red-500/20 to-orange-500/20'
  },
  {
    name: '文字转语音',
    path: '/tts',
    icon: AudioLines,
    color: 'var(--color-accent-purple)',
    desc: '文本批量转换为 MP3 语音',
    gradient: 'from-indigo-500/20 to-violet-500/20'
  },
  {
    name: '色彩调整',
    path: '/color',
    icon: Palette,
    color: 'var(--color-warning)',
    desc: '亮度/对比度/饱和度/色温调节',
    gradient: 'from-amber-500/20 to-rose-500/20'
  }
]
