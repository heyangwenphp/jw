<template>
  <section class="capability-projects-tab">
    <aside class="project-list">
      <div class="list-header">
        <div>
          <h2>能力项目</h2>
          <p>把 Agent 和 Skill 组合成可复用项目</p>
        </div>
        <button class="primary-btn" type="button" @click="startCreate">新建</button>
      </div>

      <button
        v-for="project in projects"
        :key="project.id"
        class="project-item"
        :class="{ active: activeProjectId === project.id }"
        type="button"
        @click="selectLocalProject(project.id)"
      >
        <span class="project-name">{{ project.name }}</span>
        <span class="project-meta">{{ capabilitySummary(project) || '未配置能力' }}</span>
      </button>

      <div v-if="!loading && projects.length === 0" class="empty-state">暂无能力项目</div>
    </aside>

    <main class="editor-panel">
      <div class="editor-header">
        <div>
          <h2>{{ form.id ? '编辑能力项目' : '新建能力项目' }}</h2>
          <p>这里可以维护项目使用的 Agent/Skill，也可以直接创建、编辑或导入能力。</p>
        </div>
        <button class="ghost-btn" type="button" :disabled="loading" @click="load">刷新</button>
      </div>

      <div v-if="error" class="error-banner">{{ error }}</div>

      <label class="field">
        <span>名称</span>
        <input v-model="form.name" type="text" placeholder="例如：短剧小程序" />
      </label>

      <label class="field">
        <span>描述</span>
        <input v-model="form.description" type="text" placeholder="这个能力项目适合什么场景" />
      </label>

      <div class="scope-row">
        <span>新建/导入位置</span>
        <button
          v-for="option in scopeOptions"
          :key="option.value"
          class="scope-btn"
          :class="{ active: createScope === option.value }"
          type="button"
          :disabled="option.disabled"
          @click="createScope = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="picker-grid">
        <section class="picker-box">
          <div class="picker-title-row">
            <div>
              <div class="picker-title">Agent</div>
              <div class="picker-subtitle">可只选 Agent，也可以和 Skill 组合</div>
            </div>
            <div class="mini-actions">
              <button class="tool-icon-btn" type="button" title="新建 Agent" @click="showCreateAgent">
                <Icon name="add" :size="14" />
              </button>
              <button class="tool-icon-btn" type="button" title="导入 Agent" @click="showImportAgent">
                <Icon name="import" :size="14" />
              </button>
            </div>
          </div>

          <div class="picker-list">
            <div v-for="agent in availableAgents" :key="agentKey(agent)" class="capability-row">
              <input v-model="form.agents" type="checkbox" :value="capabilityRef(agent)" :disabled="agent.disabled" />
              <button class="capability-main" type="button" @click="toggleAgent(agent)">
                <span class="check-name">@{{ capabilityRef(agent) }}</span>
                <span class="check-desc">
                  {{ agent.name }}{{ agent.description ? ` - ${agent.description}` : '' }}
                  <span v-if="agent.disabled" class="status-badge">已禁用</span>
                </span>
              </button>
              <div class="row-actions">
                <button
                  v-if="canManage(agent)"
                  class="icon-btn inline"
                  type="button"
                  title="编辑"
                  @click.stop="showEditAgent(agent)"
                >
                  <Icon name="edit" :size="14" />
                </button>
                <button
                  v-if="canDelete(agent)"
                  class="icon-btn inline"
                  type="button"
                  title="删除"
                  @click.stop="deleteAgentItem(agent)"
                >
                  <Icon name="delete" :size="14" />
                </button>
                <span
                  v-if="canManage(agent)"
                  class="toggle-hitbox"
                  :title="agent.disabled ? '启用' : '禁用'"
                  @click.stop
                >
                  <n-switch
                    class="capability-toggle"
                    size="small"
                    :value="!agent.disabled"
                    @update:value="(val) => setAgentDisabled(agent, !val)"
                  />
                </span>
              </div>
            </div>
            <div v-if="availableAgents.length === 0" class="empty-line">暂无 Agent，可先新建或导入。</div>
          </div>
        </section>

        <section class="picker-box">
          <div class="picker-title-row">
            <div>
              <div class="picker-title">Skill</div>
              <div class="picker-subtitle">可只选 Skill，也可以和 Agent 组合</div>
            </div>
            <div class="mini-actions">
              <button class="tool-icon-btn" type="button" title="新建 Skill" @click="showCreateSkill">
                <Icon name="add" :size="14" />
              </button>
              <button class="tool-icon-btn" type="button" title="导入 Skill" @click="showImportSkill">
                <Icon name="import" :size="14" />
              </button>
            </div>
          </div>

          <div class="picker-list">
            <div v-for="skill in availableSkills" :key="skillKey(skill)" class="capability-row">
              <input v-model="form.skills" type="checkbox" :value="capabilityRef(skill)" :disabled="skill.disabled" />
              <button class="capability-main" type="button" @click="toggleSkill(skill)">
                <span class="check-name">/{{ capabilityRef(skill) }}</span>
                <span class="check-desc">
                  {{ skill.name }}{{ skill.description ? ` - ${skill.description}` : '' }}
                  <span v-if="skill.disabled" class="status-badge">已禁用</span>
                </span>
              </button>
              <div class="row-actions">
                <button
                  v-if="canManage(skill)"
                  class="icon-btn inline"
                  type="button"
                  title="编辑"
                  @click.stop="showEditSkill(skill)"
                >
                  <Icon name="edit" :size="14" />
                </button>
                <button
                  v-if="canDelete(skill)"
                  class="icon-btn inline"
                  type="button"
                  title="删除"
                  @click.stop="deleteSkillItem(skill)"
                >
                  <Icon name="delete" :size="14" />
                </button>
                <span
                  v-if="canManage(skill)"
                  class="toggle-hitbox"
                  :title="skill.disabled ? '启用' : '禁用'"
                  @click.stop
                >
                  <n-switch
                    class="capability-toggle"
                    size="small"
                    :value="!skill.disabled"
                    @update:value="(val) => setSkillDisabled(skill, !val)"
                  />
                </span>
              </div>
            </div>
            <div v-if="availableSkills.length === 0" class="empty-line">暂无 Skill，可先新建或导入。</div>
          </div>
        </section>
      </div>

      <div class="selection-summary">
        已选择 {{ form.agents.length }} 个 Agent，{{ form.skills.length }} 个 Skill
      </div>

      <div class="actions">
        <button class="danger-btn" type="button" :disabled="!form.id || saving" @click="deleteCurrent">删除</button>
        <div class="actions-right">
          <button class="ghost-btn" type="button" @click="resetForm">清空</button>
          <button class="primary-btn" type="button" :disabled="!canSave || saving" @click="saveCurrent">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </main>

    <AgentEditModal
      v-model="agentEditVisible"
      :agent="editingAgent"
      :scope="createScope"
      :agents="agentGroups"
      :project-path="currentProject?.path"
      @saved="handleAgentSaved"
    />

    <AgentImportModal
      v-model="agentImportVisible"
      :current-project="currentProject"
      :default-target-source="createScope"
      @imported="handleAgentImported"
    />

    <SkillEditModal
      v-model="skillEditVisible"
      :skill="editingSkill"
      :scope="createScope"
      :skills="skillGroups"
      :project-path="currentProject?.path"
      @saved="handleSkillSaved"
    />

    <SkillImportModal
      v-model="skillImportVisible"
      :current-project="currentProject"
      :default-target-source="createScope"
      @imported="handleSkillImported"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NSwitch } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'
import AgentEditModal from '@/pages/main/components/RightPanel/tabs/agents/AgentEditModal.vue'
import AgentImportModal from '@/pages/main/components/RightPanel/tabs/agents/AgentImportModal.vue'
import SkillEditModal from '@/pages/main/components/RightPanel/tabs/skills/SkillEditModal.vue'
import SkillImportModal from '@/pages/main/components/RightPanel/tabs/skills/SkillImportModal.vue'

const props = defineProps({
  currentProject: { type: Object, default: null }
})

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const resolved = ref(null)
const activeProjectId = ref('')
const createScope = ref('user')

const agentEditVisible = ref(false)
const agentImportVisible = ref(false)
const editingAgent = ref(null)
const agentSnapshot = ref([])

const skillEditVisible = ref(false)
const skillImportVisible = ref(false)
const editingSkill = ref(null)
const skillSnapshot = ref([])

const form = reactive({
  id: '',
  name: '',
  description: '',
  agents: [],
  skills: []
})

const projects = computed(() => resolved.value?.projects || [])
const agentGroups = computed(() => resolved.value?.availableAgents || { builtIn: [], user: [], project: [], public: [], plugin: [], all: [] })
const skillGroups = computed(() => resolved.value?.availableSkills || { official: [], user: [], project: [], public: [], builtIn: [], all: [] })
const availableAgents = computed(() => [
  ...(agentGroups.value.project || []),
  ...(agentGroups.value.user || [])
])
const availableSkills = computed(() => [
  ...(skillGroups.value.project || []),
  ...(skillGroups.value.user || [])
])
const canSave = computed(() => Boolean(form.name.trim() && (form.agents.length > 0 || form.skills.length > 0)))
const currentProject = computed(() => props.currentProject || null)
const scopeOptions = computed(() => [
  { label: '全局', value: 'user', disabled: false },
  { label: '当前项目', value: 'project', disabled: !currentProject.value?.path }
])

const capabilityRef = item => item?.fullName || item?.id || item?.name || ''
const agentKey = agent => `${agent.source || 'agent'}-${capabilityRef(agent)}`
const skillKey = skill => `${skill.source || 'skill'}-${capabilityRef(skill)}`
const canManage = item => item?.canManage !== false && ['user', 'project'].includes(item?.source)
const canDelete = item => canManage(item)

const capabilitySummary = (project) => {
  const agentCount = (project.agents || []).filter(item => !item.missing).length
  const skillCount = (project.skills || []).filter(item => !item.missing).length
  const parts = []
  if (agentCount) parts.push(`${agentCount} Agent`)
  if (skillCount) parts.push(`${skillCount} Skill`)
  return parts.join(' / ')
}

const fillForm = (project = null) => {
  form.id = project?.id || ''
  form.name = project?.name || ''
  form.description = project?.description || ''
  form.agents = (project?.agents || []).filter(item => !item.missing).map(item => item.rawId || item.id)
  form.skills = (project?.skills || []).filter(item => !item.missing).map(item => item.rawId || item.id)
}

const load = async ({ keepForm = false } = {}) => {
  if (!window.electronAPI?.resolveProjectAgentProfiles) return
  loading.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.resolveProjectAgentProfiles(currentProject.value?.path || '')
    if (!result?.success) throw new Error(result?.error || '加载能力项目失败')
    resolved.value = result
    if (!keepForm) {
      const nextId = activeProjectId.value || result.selectedProjectId || result.projects?.[0]?.id || ''
      const nextProject = (result.projects || []).find(project => project.id === nextId) || null
      activeProjectId.value = nextProject?.id || ''
      fillForm(nextProject)
    }
  } catch (err) {
    console.error('[CapabilityProjectsTab] load error:', err)
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

const selectLocalProject = (projectId) => {
  activeProjectId.value = projectId
  fillForm(projects.value.find(project => project.id === projectId) || null)
}

const startCreate = () => {
  activeProjectId.value = ''
  fillForm(null)
}

const resetForm = () => {
  fillForm(null)
  activeProjectId.value = ''
}

const toggleValue = (list, value) => {
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
}

const toggleAgent = agent => {
  if (agent?.disabled) return
  toggleValue(form.agents, capabilityRef(agent))
}
const toggleSkill = skill => {
  if (skill?.disabled) return
  toggleValue(form.skills, capabilityRef(skill))
}

const snapshotRefs = list => list.map(capabilityRef).filter(Boolean)
const addNewRefs = (previousRefs, nextItems, targetList) => {
  const previous = new Set(previousRefs)
  for (const item of nextItems) {
    const refValue = capabilityRef(item)
    if (refValue && !previous.has(refValue) && !targetList.includes(refValue)) {
      targetList.push(refValue)
    }
  }
}

const showCreateAgent = () => {
  if (createScope.value === 'project' && !currentProject.value?.path) return
  agentSnapshot.value = snapshotRefs(availableAgents.value)
  editingAgent.value = null
  agentEditVisible.value = true
}

const showEditAgent = (agent) => {
  editingAgent.value = agent
  agentEditVisible.value = true
}

const showImportAgent = () => {
  agentSnapshot.value = snapshotRefs(availableAgents.value)
  agentImportVisible.value = true
}

const handleAgentSaved = async () => {
  const wasCreate = !editingAgent.value
  await load({ keepForm: true })
  if (wasCreate) addNewRefs(agentSnapshot.value, availableAgents.value, form.agents)
  editingAgent.value = null
}

const handleAgentImported = async () => {
  await load({ keepForm: true })
  addNewRefs(agentSnapshot.value, availableAgents.value, form.agents)
}

const setAgentDisabled = async (agent, nextDisabled) => {
  if (!agent?.id || (!window.electronAPI?.toggleComponentDisabled && !window.electronAPI?.toggleAgentDisabled)) return
  saving.value = true
  error.value = ''
  try {
    const result = window.electronAPI.toggleAgentDisabled
      ? await window.electronAPI.toggleAgentDisabled({
          source: agent.source || 'user',
          agentId: agent.id,
          disabled: nextDisabled,
          projectPath: currentProject.value?.path
        })
      : await window.electronAPI.toggleComponentDisabled('agent', agent.id, nextDisabled)
    if (!result?.success) throw new Error(result?.error || '切换 Agent 状态失败')
    if (nextDisabled) {
      form.agents = form.agents.filter(id => id !== capabilityRef(agent))
    }
    await load({ keepForm: true })
  } catch (err) {
    console.error('[CapabilityProjectsTab] toggle agent error:', err)
    error.value = err?.message || '切换 Agent 状态失败'
  } finally {
    saving.value = false
  }
}

const deleteAgentItem = async (agent) => {
  if (!agent?.id || !window.electronAPI?.deleteAgent) return
  if (!window.confirm(`确定删除 Agent「${agent.id}」吗？`)) return
  saving.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.deleteAgent({
      source: agent.source,
      agentId: agent.id,
      projectPath: currentProject.value?.path
    })
    if (!result?.success) throw new Error(result?.error || '删除 Agent 失败')
    form.agents = form.agents.filter(id => id !== capabilityRef(agent))
    await load({ keepForm: true })
  } catch (err) {
    console.error('[CapabilityProjectsTab] delete agent error:', err)
    error.value = err?.message || '删除 Agent 失败'
  } finally {
    saving.value = false
  }
}

const showCreateSkill = () => {
  if (createScope.value === 'project' && !currentProject.value?.path) return
  skillSnapshot.value = snapshotRefs(availableSkills.value)
  editingSkill.value = null
  skillEditVisible.value = true
}

const showEditSkill = (skill) => {
  editingSkill.value = skill
  skillEditVisible.value = true
}

const showImportSkill = () => {
  skillSnapshot.value = snapshotRefs(availableSkills.value)
  skillImportVisible.value = true
}

const handleSkillSaved = async () => {
  const wasCreate = !editingSkill.value
  await load({ keepForm: true })
  if (wasCreate) addNewRefs(skillSnapshot.value, availableSkills.value, form.skills)
  editingSkill.value = null
}

const handleSkillImported = async () => {
  await load({ keepForm: true })
  addNewRefs(skillSnapshot.value, availableSkills.value, form.skills)
}

const setSkillDisabled = async (skill, nextDisabled) => {
  if (!skill?.id || (!window.electronAPI?.toggleComponentDisabled && !window.electronAPI?.toggleSkillDisabled)) return
  saving.value = true
  error.value = ''
  try {
    const result = window.electronAPI.toggleSkillDisabled
      ? await window.electronAPI.toggleSkillDisabled({
          source: skill.source || 'user',
          skillId: skill.id,
          disabled: nextDisabled,
          projectPath: currentProject.value?.path
        })
      : await window.electronAPI.toggleComponentDisabled('skill', skill.id, nextDisabled)
    if (!result?.success) throw new Error(result?.error || '切换 Skill 状态失败')
    if (nextDisabled) {
      form.skills = form.skills.filter(id => id !== capabilityRef(skill))
    }
    await load({ keepForm: true })
  } catch (err) {
    console.error('[CapabilityProjectsTab] toggle skill error:', err)
    error.value = err?.message || '切换 Skill 状态失败'
  } finally {
    saving.value = false
  }
}

const deleteSkillItem = async (skill) => {
  if (!skill?.id || !window.electronAPI?.deleteSkill) return
  if (!window.confirm(`确定删除 Skill「${skill.id}」吗？`)) return
  saving.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.deleteSkill({
      source: skill.source,
      skillId: skill.id,
      projectPath: currentProject.value?.path
    })
    if (!result?.success) throw new Error(result?.error || '删除 Skill 失败')
    form.skills = form.skills.filter(id => id !== capabilityRef(skill))
    await load({ keepForm: true })
  } catch (err) {
    console.error('[CapabilityProjectsTab] delete skill error:', err)
    error.value = err?.message || '删除 Skill 失败'
  } finally {
    saving.value = false
  }
}

const saveCurrent = async () => {
  if (!canSave.value || !window.electronAPI?.saveCapabilityProject) return
  saving.value = true
  error.value = ''
  try {
    const profile = {
      id: 'default',
      name: '默认组合',
      agent: form.agents[0] || '',
      skills: [...form.skills]
    }
    const result = await window.electronAPI.saveCapabilityProject({
      select: true,
      project: {
        id: form.id || undefined,
        name: form.name.trim(),
        description: form.description.trim(),
        agents: [...form.agents],
        skills: [...form.skills],
        profiles: [profile],
        defaultProfileId: profile.id
      }
    })
    if (!result?.success) throw new Error(result?.error || '保存失败')
    activeProjectId.value = result.project?.id || activeProjectId.value
    await load()
  } catch (err) {
    console.error('[CapabilityProjectsTab] save error:', err)
    error.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

const deleteCurrent = async () => {
  if (!form.id || !window.electronAPI?.deleteCapabilityProject) return
  saving.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.deleteCapabilityProject({ projectId: form.id })
    if (!result?.success) throw new Error(result?.error || '删除失败')
    activeProjectId.value = ''
    await load()
  } catch (err) {
    console.error('[CapabilityProjectsTab] delete error:', err)
    error.value = err?.message || '删除失败'
  } finally {
    saving.value = false
  }
}

watch(() => currentProject.value?.path, () => {
  if (!currentProject.value?.path && createScope.value === 'project') createScope.value = 'user'
  load()
})

onMounted(load)
</script>

<style scoped>
.capability-projects-tab {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.project-list,
.editor-panel {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
}

.project-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-header,
.editor-header {
  padding: 14px;
  border-bottom: 1px solid var(--border-color);
}

.list-header,
.editor-header,
.picker-title-row,
.actions,
.scope-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.list-header,
.editor-header {
  align-items: flex-start;
}

h2 {
  margin: 0;
  font-size: 15px;
  color: var(--text-color);
}

p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-color-3);
}

.project-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.project-item.active,
.project-item:hover {
  background: var(--hover-bg);
}

.project-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.project-meta,
.empty-state,
.empty-line,
.selection-summary {
  font-size: 12px;
  color: var(--text-color-3);
}

.empty-state,
.empty-line {
  padding: 14px;
}

.editor-panel {
  overflow: auto;
  padding-bottom: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 14px 0;
  font-size: 12px;
  color: var(--text-color-2);
}

.field input {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-color);
  padding: 8px 10px;
  font-size: 13px;
}

.scope-row {
  justify-content: flex-start;
  padding: 14px 14px 0;
  font-size: 12px;
  color: var(--text-color-2);
}

.scope-btn {
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--input-bg);
  color: var(--text-color-2);
  cursor: pointer;
  font-size: 12px;
}

.scope-btn.active {
  color: #fff;
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.scope-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.picker-box {
  min-height: 300px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.picker-title-row {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
}

.picker-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.picker-subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-3);
}

.mini-actions,
.actions-right {
  display: flex;
  gap: 6px;
}

.tool-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-muted);
  transition: all 0.15s ease;
}

.tool-icon-btn:hover {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.picker-list {
  max-height: 380px;
  overflow: auto;
}

.capability-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
}

.capability-row:hover {
  background: var(--hover-bg);
}

.capability-main {
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.check-name,
.check-desc {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-name {
  font-size: 12px;
  color: var(--text-color);
}

.check-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-color-3);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.row-actions .icon-btn.inline {
  display: none;
}

.capability-row:hover .row-actions .icon-btn.inline {
  display: inline-flex;
  opacity: 0.7;
}

.toggle-hitbox {
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.capability-toggle {
  flex-shrink: 0;
}

.status-badge {
  margin-left: 6px;
  color: #d48806;
}

.selection-summary {
  padding: 0 14px 12px;
}

.actions {
  padding: 0 14px;
}

.primary-btn,
.ghost-btn,
.danger-btn {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.primary-btn {
  color: #fff;
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.ghost-btn {
  color: var(--text-color-2);
  background: var(--input-bg);
}

.danger-btn {
  color: #d03050;
  background: var(--input-bg);
}

.primary-btn:disabled,
.ghost-btn:disabled,
.danger-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.error-banner {
  margin: 14px 14px 0;
  padding: 8px 10px;
  border: 1px solid #d03050;
  border-radius: 7px;
  color: #d03050;
  font-size: 12px;
}

@media (max-width: 900px) {
  .capability-projects-tab {
    grid-template-columns: 1fr;
  }

  .picker-grid {
    grid-template-columns: 1fr;
  }
}
</style>
