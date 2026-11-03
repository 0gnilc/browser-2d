<script setup lang="ts">
import { ElButton, ElIcon, ElTooltip } from 'element-plus';
import { Monitor, Files, Setting, Fold, Expand } from '@element-plus/icons-vue';
import { computed, onMounted, onUnmounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { useDesktopApi } from '../platform/desktop-api';
import { useWorkTasksStore } from '../stores/work-tasks';
import { useApplicationSettingsStore } from '../stores/application-settings';

const api = useDesktopApi();
const work = useWorkTasksStore();
const settings = useApplicationSettingsStore();
const sidebarCollapsed = computed(() => settings.current?.values.sidebarCollapsed ?? false);
const connectionLabel = computed(
  () =>
    ({ connecting: '正在连接', connected: '已连接', unavailable: '连接不可用' })[work.connection],
);
const navigation = [
  { path: '/', label: '浏览器', id: 'nav-browsers', icon: Monitor },
  { path: '/cards', label: '卡', id: 'nav-cards', icon: Files },
  { path: '/settings', label: '设置', id: 'nav-settings', icon: Setting },
];
let disconnect = () => {};
onMounted(() => {
  disconnect = work.connect(api);
  void settings.load(api);
});
onUnmounted(() => disconnect());
</script>

<template>
  <div class="app-shell min-h-screen" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar flex flex-col">
      <RouterLink class="app-name" to="/" aria-label="Browser 2D 首页"
        >2D <span v-if="!sidebarCollapsed">Browser 2D</span></RouterLink
      >
      <nav id="primary-navigation" class="flex flex-1 flex-col gap-2" aria-label="页面导航">
        <ElTooltip
          v-for="item in navigation"
          :key="item.path"
          :content="item.label"
          :disabled="!sidebarCollapsed"
          :trigger="['hover', 'focus']"
          :trigger-keys="[]"
          placement="right"
        >
          <RouterLink
            :to="item.path"
            :data-testid="item.id"
            :aria-label="item.label"
            class="nav-link"
            :class="{ 'settings-link': item.path === '/settings' }"
          >
            <ElIcon :size="21" aria-hidden="true"><component :is="item.icon" /></ElIcon
            ><span v-if="!sidebarCollapsed">{{ item.label }}</span>
          </RouterLink>
        </ElTooltip>
      </nav>
      <ElButton
        class="sidebar-toggle"
        data-testid="sidebar-toggle"
        :icon="sidebarCollapsed ? Expand : Fold"
        :disabled="!settings.current || settings.saving"
        :aria-expanded="!sidebarCollapsed"
        aria-controls="primary-navigation"
        :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="settings.toggleSidebar(api)"
      >
        <template v-if="!sidebarCollapsed" #default>收起侧边栏</template>
      </ElButton>
      <p
        v-if="settings.error && settings.current"
        class="sidebar-error"
        role="alert"
        :title="settings.error"
      >
        {{ sidebarCollapsed ? '设置未保存' : settings.error }}
      </p>
      <ElTooltip
        :content="connectionLabel"
        :disabled="!sidebarCollapsed"
        :trigger="['hover', 'focus']"
        :trigger-keys="[]"
        placement="right"
      >
        <div
          class="sidebar-status"
          data-testid="connection-status"
          :data-state="work.connection"
          role="status"
          tabindex="0"
          :aria-label="connectionLabel"
        >
          <span class="status-dot" :class="work.connection" aria-hidden="true" /><span
            v-if="!sidebarCollapsed"
            >{{ connectionLabel }}</span
          >
        </div>
      </ElTooltip>
    </aside>
    <div class="app-content min-w-0"><RouterView /></div>
  </div>
</template>
