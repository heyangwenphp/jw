<template>
  <aside class="project-library-left left-panel">
    <LeftPanelHeader />

    <div class="agent-left-content">
      <nav class="home-nav-area">
        <button class="home-nav-item" type="button" @click="$emit('home-request')">
          <Icon name="home" :size="14" />
          <span>美的舆情推送监控</span>
        </button>
        <button class="home-nav-item active" type="button">
          <Icon name="folderOpen" :size="14" />
          <span>项目库</span>
        </button>
      </nav>

      <div class="new-session-area">
        <button class="new-session-btn" type="button" @click="$emit('create-project')">
          <span class="icon">+</span>
          <span>新建项目</span>
        </button>
      </div>

      <div class="conversation-list project-tree-list">
        <ProjectLibraryTree
          :workspaces="workspaces"
          :active-workspace-id="activeWorkspaceId"
          :active-item-id="activeItemId"
          @select-workspace="$emit('select-workspace', $event)"
          @select-item="$emit('select-item', $event)"
          @create-item="$emit('create-item', $event)"
          @upload-file="$emit('upload-file', $event)"
          @download-file="$emit('download-file', $event)"
          @rename-item="$emit('rename-item', $event)"
          @delete-item="$emit('delete-item', $event)"
          @delete-workspace="$emit('delete-workspace', $event)"
        />

        <div v-if="!loading && workspaces.length === 0" class="empty-hint">
          暂无项目
        </div>
      </div>
    </div>

    <LeftPanelFooter
      :t="t"
      :settings-options="settingsOptions"
      :render-settings-label="renderSettingsLabel"
      :has-update-available="hasUpdateAvailable"
      :is-dark="isDark"
      :is-agent-mode="true"
      :show-settings="showFooterSettings"
      @settings-select="$emit('settings-select', $event)"
      @toggle-theme="$emit('toggle-theme')"
    />
  </aside>
</template>

<script setup>
import Icon from '@components/icons/Icon.vue'
import LeftPanelHeader from '../LeftPanelHeader.vue'
import LeftPanelFooter from '../LeftPanelFooter.vue'
import ProjectLibraryTree from './ProjectLibraryTree.vue'

defineProps({
  t: {
    type: Function,
    required: true
  },
  workspaces: {
    type: Array,
    default: () => []
  },
  activeWorkspaceId: {
    type: Number,
    default: null
  },
  activeItemId: {
    type: Number,
    default: null
  },
  loading: {
    type: Boolean,
    default: false
  },
  settingsOptions: {
    type: Array,
    default: () => []
  },
  renderSettingsLabel: {
    type: Function,
    required: true
  },
  hasUpdateAvailable: {
    type: Boolean,
    default: false
  },
  isDark: {
    type: Boolean,
    default: false
  },
  showFooterSettings: {
    type: Boolean,
    default: false
  }
})

defineEmits([
  'home-request',
  'refresh',
  'create-project',
  'select-workspace',
  'select-item',
  'create-item',
  'upload-file',
  'download-file',
  'rename-item',
  'delete-item',
  'delete-workspace',
  'settings-select',
  'toggle-theme'
])
</script>

<style scoped>
.project-library-left {
  width: 280px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  overflow: visible;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.agent-left-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: visible;
  background: var(--panel-bg);
}

.home-nav-area {
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.home-nav-item {
  width: 100%;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition: all 0.2s ease;
}

.home-nav-item + .home-nav-item {
  margin-top: 8px;
}

.home-nav-item:not(.active):hover {
  background: var(--panel-bg-subtle);
}

.home-nav-item.active {
  background: var(--selected-bg);
  border-color: var(--selected-border);
  color: var(--primary-color);
}

.new-session-area {
  padding: 8px 16px 12px;
  flex-shrink: 0;
}

.new-session-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin: 15px 0;
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: var(--primary-color);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.new-session-btn:hover {
  background: var(--primary-color-hover);
  transform: translateY(-1px);
  box-shadow: var(--primary-shadow);
}

.new-session-btn .icon {
  font-size: 16px;
  font-weight: bold;
}

.conversation-list {
  min-height: 0;
  flex: 1;
  overflow-x: visible;
  overflow-y: auto;
  padding: 4px 16px 16px;
}

:deep(.panel-footer) {
  border-top: 1px solid var(--border-color-light);
}

.empty-hint {
  margin: 24px 16px;
  color: var(--text-color-muted);
  font-size: 13px;
  text-align: center;
}
</style>
