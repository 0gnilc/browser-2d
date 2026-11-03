<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <main class="workspace">
    <header class="page-heading">
      <div>
        <h1>{{ title }}</h1>
        <p v-if="description" class="description">{{ description }}</p>
      </div>
      <div class="page-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </main>
</template>
