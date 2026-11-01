<script setup lang="ts">
import { NConfigProvider, zhCN, dateZhCN } from 'naive-ui';
import { inject, onMounted, onUnmounted } from 'vue';
import { bridgeKey } from './bridge';
import { useRunsStore } from './runs';
import WorkStatus from './WorkStatus.vue';
import { RouterLink, RouterView } from 'vue-router';
const store = useRunsStore();
const api = inject(bridgeKey);
let disconnect = () => {};
onMounted(() => {
  disconnect = store.connect(api);
});
onUnmounted(() => disconnect());
</script>

<template>
  <NConfigProvider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="{
      common: {
        primaryColor: '#236b53',
        primaryColorHover: '#2c8064',
        borderRadius: '7px',
      },
    }"
  >
    <nav class="workspace business-nav" aria-label="页面导航">
      <RouterLink class="brand nav-brand" to="/" aria-label="Browser 2D 首页"
        ><span class="brand-mark">2D</span><span>Browser 2D</span></RouterLink
      >
      <RouterLink to="/">任务</RouterLink>
      <RouterLink to="/devices" data-testid="nav-devices">设备</RouterLink>
      <RouterLink to="/materials" data-testid="nav-materials">材料</RouterLink>
      <RouterLink to="/history" data-testid="nav-history">历史</RouterLink>
      <RouterLink to="/settings" data-testid="nav-settings">设置</RouterLink>
    </nav>
    <WorkStatus />
    <RouterView />
  </NConfigProvider>
</template>
