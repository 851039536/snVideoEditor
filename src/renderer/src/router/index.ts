import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home/HomeView.vue')
  },
  {
    path: '/split-merge',
    name: 'SplitMerge',
    component: () => import('@/views/SplitMerge/SplitMergeView.vue')
  },
  {
    path: '/compress',
    name: 'Compress',
    component: () => import('@/views/Compress/CompressView.vue')
  },
  {
    path: '/encrypt',
    name: 'Encrypt',
    component: () => import('@/views/Encrypt/EncryptView.vue')
  },
  {
    path: '/gif',
    name: 'Gif',
    component: () => import('@/views/Gif/GifConvertView.vue')
  },
  {
    path: '/download',
    name: 'Download',
    component: () => import('@/views/Download/DownloadView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
