<template>
  <div class="project-agent-panel" @click.stop>
    <div class="panel-header">
      <div>
        <div class="panel-title">项目能力</div>
      </div>
      <div class="panel-actions">
        <button class="icon-action" type="button" :disabled="loading" title="刷新" @click="load">
          <Icon name="refresh" :size="13" :class="{ spinning: loading }" />
        </button>
        <button class="manage-action" type="button" @click="openManager">管理</button>
      </div>
    </div>

    <div v-if="loading" class="panel-state">加载中...</div>
    <div v-else-if="error" class="panel-state error">{{ error }}</div>
    <template v-else>
      <div v-if="projects.length > 0" class="project-list">
        <button
          v-for="project in projects"
          :key="project.id"
          class="cap-item project-item"
          :class="{ active: project.id === selectedProjectId, disabled: !project.usable }"
          type="button"
          :disabled="!project.usable"
          @click="useProject(project)"
        >
          <span class="cap-type-dot dot-project"></span>
          <span class="cap-type-label label-project">项目</span>
          <span class="cap-item-name">
            {{ project.name }}
            <span v-if="project.id === selectedProjectId" class="active-badge">当前</span>
          </span>
          <span class="cap-item-desc">{{ project.description || projectSummary(project) || '未配置能力' }}</span>
        </button>
      </div>
      <div v-else class="cap-empty">暂无能力项目，请先到设置中创建。</div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '@components/icons/Icon.vue'

const props = defineProps({
  projectPath: { type: String, default: null }
})

const emit = defineEmits(['apply'])

const loading = ref(false)
const error = ref('')
const resolved = ref(null)
const selectedProjectId = ref('')

const projects = computed(() => resolved.value?.projects || [])

const load = async () => {
  if (!window.electronAPI?.resolveProjectAgentProfiles) return
  loading.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.resolveProjectAgentProfiles(props.projectPath || '')
    if (!result?.success) throw new Error(result?.error || '加载能力项目失败')
    resolved.value = result
    selectedProjectId.value = result.selectedProjectId || result.selectedProject?.id || ''
  } catch (err) {
    console.error('[ProjectAgentQuickPanel] load error:', err)
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

const selectProject = async (projectId) => {
  if (!window.electronAPI?.selectCapabilityProject || !projectId) return
  selectedProjectId.value = projectId
  const result = await window.electronAPI.selectCapabilityProject({
    projectId,
    projectPath: props.projectPath || ''
  })
  if (!result?.success) {
    error.value = result?.error || '切换能力项目失败'
  }
}

const useProject = async (project) => {
  if (!project?.usable) return
  await selectProject(project.id)
  emit('apply', project.invocationRefs || [])
}

const openManager = () => {
  window.electronAPI?.openSettingsWorkbench?.({ tab: 'capabilityProjects' })
}

const projectSummary = (project) => [
  ...(project.agents || []).filter(item => !item.missing).map(item => `@${item.id}`),
  ...(project.skills || []).filter(item => !item.missing).map(item => `/${item.id}`)
].join(' ')

watch(() => props.projectPath, load)
onMounted(load)
</script>

<style scoped>
.project-agent-panel {
  width: min(360px, calc(100vw - 32px));
  max-height: 280px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-color);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 4px 6px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.panel-subtitle,
.panel-state,
.cap-empty {
  font-size: 12px;
  color: var(--text-color-3);
}

.panel-subtitle {
  margin-top: 2px;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.icon-action,
.manage-action {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-color-2);
  cursor: pointer;
  font-size: 12px;
}

.icon-action {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.manage-action {
  height: 26px;
  padding: 0 8px;
}

.icon-action:hover,
.manage-action:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.panel-state,
.cap-empty {
  padding: 10px;
}

.panel-state.error {
  color: #d03050;
}

.project-list {
  display: flex;
  flex-direction: column;
}

.cap-item {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.cap-item:hover,
.cap-item.active {
  background: var(--hover-bg);
}

.cap-item:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.cap-type-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  grid-row: 1 / span 2;
}

.dot-project {
  background: #10b981;
}

.cap-type-label {
  font-size: 11px;
  color: var(--text-color-3);
}

.cap-item-name,
.cap-item-desc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cap-item-name {
  font-size: 13px;
  color: var(--text-color);
}

.cap-item-desc {
  grid-column: 3;
  font-size: 12px;
  color: var(--text-color-3);
}

.active-badge {
  margin-left: 6px;
  font-size: 10px;
  color: var(--primary-color);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
