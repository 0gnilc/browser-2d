<script setup lang="ts">
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import DesktopLayout from './layouts/DesktopLayout.vue';
</script>

<template>
  <ElConfigProvider :locale="zhCn"><DesktopLayout /></ElConfigProvider>
</template>
