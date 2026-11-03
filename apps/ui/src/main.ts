import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { desktopApiKey } from './platform/desktop-api';
import { unavailableApi } from './platform/unavailable-api';
import { router } from './router';
import 'element-plus/dist/index.css';
import './assets/styles/main.css';

createApp(App)
  .use(createPinia())
  .use(router)
  .provide(desktopApiKey, window.browser2d ?? unavailableApi)
  .mount('#app');
