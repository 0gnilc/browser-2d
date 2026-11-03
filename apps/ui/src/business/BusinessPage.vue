<script setup lang="ts">
import { ElAlert } from 'element-plus';
defineProps<{ title: string; error: string }>();
</script>
<template>
  <main class="workspace business-page">
    <header class="page-heading">
      <h1>{{ title }}</h1>
    </header>
    <ElAlert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      role="alert"
      data-testid="business-error"
      class="error-message"
    />
    <slot />
  </main>
</template>
