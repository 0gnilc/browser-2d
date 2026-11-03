import { createRouter, createWebHashHistory } from 'vue-router';
import BrowsersPage from '../views/browsers/BrowsersPage.vue';
import CardsPage from '../views/cards/CardsPage.vue';
import SettingsPage from '../views/settings/SettingsPage.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: BrowsersPage },
    { path: '/cards', component: CardsPage },
    { path: '/settings', component: SettingsPage },
  ],
});
