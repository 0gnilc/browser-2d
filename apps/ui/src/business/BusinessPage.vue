<script setup lang="ts">
import { NAlert } from 'naive-ui';
defineProps<{ title: string; error: string }>();
</script>

<template>
  <main class="workspace business-page">
    <header class="intro">
      <p class="eyebrow">P2 · 业务数据</p>
      <h1>{{ title }}</h1>
    </header>
    <NAlert
      v-if="error"
      type="error"
      role="alert"
      data-testid="business-error"
      class="error-message"
    >
      {{ error }}
    </NAlert>
    <slot />
  </main>
</template>
