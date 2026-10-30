import { createRouter, createWebHashHistory } from 'vue-router';
import Foundation from './Foundation.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: Foundation }],
});
