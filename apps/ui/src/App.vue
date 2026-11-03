<script setup lang="ts">
import { ElButton, ElConfigProvider, ElIcon, ElTooltip } from 'element-plus';
import { VideoPlay, Monitor, Files, Clock, Setting, Fold, Expand } from '@element-plus/icons-vue';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { bridgeKey } from './bridge';
import { useRunsStore } from './runs';
import WorkStatus from './WorkStatus.vue';
import { RouterLink, RouterView } from 'vue-router';
const store = useRunsStore();
const api = inject(bridgeKey);
const sidebarStorageKey = 'browser2d.sidebar.collapsed';
function readSidebarCollapsed() {
  try {
    return globalThis.localStorage.getItem(sidebarStorageKey) === 'true';
  } catch {
    return false;
  }
}
const sidebarCollapsed = ref(readSidebarCollapsed());
const connectionLabel = computed(
  () =>
    ({ connecting: '正在连接', connected: '已连接', unavailable: '连接不可用' })[store.connection],
);
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  try {
    globalThis.localStorage.setItem(sidebarStorageKey, String(sidebarCollapsed.value));
  } catch {
    return;
  }
}
const navigation = [
  { path: '/', label: '任务', id: 'nav-tasks', icon: VideoPlay },
  { path: '/devices', label: '设备', id: 'nav-devices', icon: Monitor },
  { path: '/materials', label: '材料', id: 'nav-materials', icon: Files },
  { path: '/history', label: '历史', id: 'nav-history', icon: Clock },
  { path: '/settings', label: '设置', id: 'nav-settings', icon: Setting },
];
let disconnect = () => {};
onMounted(() => {
  disconnect = store.connect(api);
});
onUnmounted(() => disconnect());
</script>

<template>
  <ElConfigProvider :locale="zhCn">
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
          :aria-expanded="!sidebarCollapsed"
          aria-controls="primary-navigation"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="toggleSidebar"
        >
          <template v-if="!sidebarCollapsed" #default>收起侧边栏</template>
        </ElButton>
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
            :data-state="store.connection"
            role="status"
            tabindex="0"
            :aria-label="connectionLabel"
          >
            <span class="status-dot" :class="store.connection" aria-hidden="true"></span
            ><span v-if="!sidebarCollapsed">{{ connectionLabel }}</span>
          </div>
        </ElTooltip>
      </aside>
      <div class="app-content min-w-0"><WorkStatus /><RouterView /></div>
    </div>
  </ElConfigProvider>
</template>
