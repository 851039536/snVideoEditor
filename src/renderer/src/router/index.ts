import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue')
  },
  {
    path: '/split-merge',
    name: 'SplitMerge',
    component: () => import('@/views/SplitMergeView.vue')
  },
  {
    path: '/compress',
    name: 'Compress',
    component: () => import('@/views/CompressView.vue')
  },
  {
    path: '/encrypt',
    name: 'Encrypt',
    component: () => import('@/views/EncryptView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
