import { createRouter, createWebHashHistory } from 'vue-router';
import Foundation from './Foundation.vue';
import Devices from './business/Devices.vue';
import Materials from './business/Materials.vue';
import History from './business/History.vue';
import Settings from './business/Settings.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Foundation },
    { path: '/foundation', component: Foundation },
    { path: '/devices', component: Devices },
    { path: '/materials', component: Materials },
    { path: '/history', component: History },
    { path: '/settings', component: Settings },
  ],
});
