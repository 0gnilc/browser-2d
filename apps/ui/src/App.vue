<script setup lang="ts">
import { NConfigProvider } from 'naive-ui';
import { RouterView } from 'vue-router';
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
    <RouterView />
  </NConfigProvider>
</template>
