import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { bridgeKey } from './bridge';
import { router } from './router';
import './style.css';

async function mount() {
  const api =
    import.meta.env.VITE_FIXTURE_MODE === '1'
      ? (await import('./fixture')).createFixtureBridge()
      : window.browser2d;
  createApp(App).use(createPinia()).use(router).provide(bridgeKey, api).mount('#app');
}

void mount();
