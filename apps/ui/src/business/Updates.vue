<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { NButton, NPopconfirm } from 'naive-ui';
import type { UpdateState } from '@browser-2d/contracts/public';
import { bridgeKey } from '../bridge';

const api = inject(bridgeKey)?.updates;
const state = ref<UpdateState>();
const error = ref('');
const busy = ref(false);
let dispose: (() => void) | undefined;
let mounted = true;
function receive(next: UpdateState) {
  if (mounted && (!state.value || next.revision >= state.value.revision)) state.value = next;
}
const description = computed(() => {
  const current = state.value;
  if (!current) return api ? '正在读取更新状态…' : '请在桌面应用中查看更新。';
  switch (current.status) {
    case 'unavailable':
      return {
        development: '开发版本不提供应用更新。',
        unconfigured: '此预览版本尚未启用更新渠道。',
        'package-manager': '请使用系统软件包管理器更新此应用。',
      }[current.reason];
    case 'idle':
      return '可手动检查此渠道是否有新版本。';
    case 'checking':
      return '正在检查新版本…';
    case 'available':
      return `发现新版本 ${current.version}。下载后可选择安装时间。`;
    case 'downloading':
      return `正在下载 ${current.version}，已完成 ${Math.floor(current.percent)}%。`;
    case 'downloaded':
      return `版本 ${current.version} 已下载。安装会停止当前任务并重启应用。`;
    case 'installing':
      return '正在停止任务并关闭应用拥有的浏览器资源，随后安装更新…';
    case 'failed':
      return current.restartRequired
        ? '更新安装失败。请关闭并重新打开应用后重试。'
        : '更新未完成。请检查网络连接，然后重新检查更新。';
    default: {
      const exhaustive: never = current;
      return exhaustive;
    }
  }
});
const canCheck = computed(
  () =>
    state.value &&
    (['idle', 'available', 'downloaded'].includes(state.value.status) ||
      (state.value.status === 'failed' && !state.value.restartRequired)),
);
async function perform(action: 'check' | 'download' | 'install') {
  if (!api || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api[action]();
    if (!mounted) return;
    if (!result.ok) error.value = '操作未完成，请稍后重试。';
    else if ('status' in result.value) receive(result.value);
  } catch {
    if (mounted) error.value = '更新服务不可用，请重新打开应用。';
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  if (!api) return;
  dispose = api.subscribe(receive);
  try {
    const result = await api.getState();
    if (result.ok) receive(result.value);
    else if (mounted) error.value = '无法读取更新状态，请重新打开应用。';
  } catch {
    if (mounted) error.value = '更新服务不可用，请重新打开应用。';
  }
});
onUnmounted(() => {
  mounted = false;
  dispose?.();
});
</script>

<template>
  <section class="task-panel" aria-labelledby="updates-title" data-testid="updates-panel">
    <div class="business-toolbar">
      <h2 id="updates-title">应用更新</h2>
      <span v-if="state">当前版本 {{ state.currentVersion }}</span>
    </div>
    <p v-if="state && state.status !== 'unavailable'">
      更新渠道：{{ state.channel === 'stable' ? '稳定版' : '测试版' }}
    </p>
    <p role="status" aria-live="polite" data-testid="update-status">{{ description }}</p>
    <progress
      v-if="state?.status === 'downloading'"
      :value="state.percent"
      max="100"
      aria-label="更新下载进度"
    />
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="business-actions">
      <NButton v-if="canCheck" :disabled="busy" data-testid="update-check" @click="perform('check')"
        >检查更新</NButton
      >
      <NButton
        v-if="state?.status === 'available'"
        type="primary"
        :disabled="busy"
        data-testid="update-download"
        @click="perform('download')"
        >下载更新</NButton
      >
      <NPopconfirm
        v-if="state?.status === 'downloaded'"
        positive-text="停止任务并安装"
        negative-text="暂不安装"
        @positive-click="perform('install')"
      >
        <template #trigger
          ><NButton type="primary" :disabled="busy" data-testid="update-install"
            >安装并重启</NButton
          ></template
        >
        当前任务将停止，应用拥有的浏览器资源将关闭。是否现在安装并重启？
      </NPopconfirm>
    </div>
  </section>
</template>
