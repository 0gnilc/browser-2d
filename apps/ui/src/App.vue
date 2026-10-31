<script setup lang="ts">
import { NConfigProvider } from 'naive-ui';
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <NConfigProvider
    :theme-overrides="{
      common: {
        primaryColor: '#236b53',
        primaryColorHover: '#2c8064',
        borderRadius: '7px',
      },
    }"
  >
    <nav class="workspace business-nav" aria-label="页面导航">
      <RouterLink to="/">调度验收</RouterLink>
      <RouterLink to="/devices" data-testid="nav-devices">设备</RouterLink>
      <RouterLink to="/materials" data-testid="nav-materials">材料</RouterLink>
      <RouterLink to="/history" data-testid="nav-history">历史</RouterLink>
      <RouterLink to="/settings" data-testid="nav-settings">设置</RouterLink>
    </nav>
    <RouterView />
  </NConfigProvider>
</template>
