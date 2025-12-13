import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: { name: 'index' }
    },
    {
      path: '/index',
      name: 'index',
      component: () => import('@/views/index/index.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/history/index.vue'),
    },
    {
      path: '/setting',
      name: 'setting',
      component: () => import('@/views/setting/index.vue'),
    },
  ],
})

export default router
