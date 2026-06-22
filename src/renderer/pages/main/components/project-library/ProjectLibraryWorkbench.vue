<template>
  <div class="project-library-workbench">
    <ProjectLibraryLeftPanel
      :t="t"
      :workspaces="workspacesWithActiveItems"
      :active-workspace-id="activeWorkspace?.id || null"
      :active-item-id="activeItem?.id || null"
      :loading="loading"
      :settings-options="settingsOptions"
      :render-settings-label="renderSettingsLabel"
      :has-update-available="hasUpdateAvailable"
      :is-dark="isDark"
      :show-footer-settings="showFooterSettings"
      @home-request="emit('home-request')"
      @refresh="reload"
      @create-project="openCreateModal"
      @select-workspace="selectWorkspace"
      @select-item="selectItem"
      @create-item="handleCreateItem"
      @upload-file="openProjectFileUpload"
      @download-file="handleDownloadItemFile"
      @rename-item="handleRenameItem"
      @delete-item="handleDeleteItem"
      @delete-workspace="handleDeleteWorkspace"
      @settings-select="handleSettingsSelect"
      @toggle-theme="emit('toggle-theme')"
    />

    <ProjectLibraryContent
      :workspace="activeWorkspace"
      :active-item="activeItem"
      :messages="messages"
      :sending="sending"
      :active-session-id="activeAgentSessionId"
      :selected-model="selectedModel"
      :model-options="modelOptions"
      @update:selected-model="selectedModel = $event"
      @save-content="saveActiveItemContent"
      @send="sendProjectMessage"
    />

    <ProjectCreateModal
      v-model:show="showCreateModal"
      :master-records="masterRecords"
      :submitting="creatingProject"
      @create="handleCreateWorkspace"
    />

    <ProjectLibraryItemNameModal
      v-model:show="showItemNameModal"
      :title="itemNameModalState.title"
      :field-label="itemNameModalState.fieldLabel"
      :placeholder="itemNameModalState.placeholder"
      :initial-name="itemNameModalState.initialName"
      :submit-text="itemNameModalState.submitText"
      :submitting="itemNameSubmitting"
      @submit="handleItemNameSubmit"
    />

    <input
      ref="projectFileInputRef"
      type="file"
      multiple
      style="display: none"
      @change="handleProjectFileUpload"
    />
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import { useProjectLibrary } from '@composables/useProjectLibrary'
import Icon from '@components/icons/Icon.vue'
import { redirectToLoginPage } from '@utils/auth-navigation'
import { buildFileDownloadUrl, downloadFileFromUrl } from '@utils/file-preview-url-utils'
import ProjectCreateModal from './ProjectCreateModal.vue'
import ProjectLibraryContent from './ProjectLibraryContent.vue'
import ProjectLibraryItemNameModal from './ProjectLibraryItemNameModal.vue'
import ProjectLibraryLeftPanel from './ProjectLibraryLeftPanel.vue'

defineProps({
  isDark: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['home-request', 'toggle-theme'])

const message = useMessage()
const dialog = useDialog()
const { t } = useLocale()
const showCreateModal = ref(false)
const showItemNameModal = ref(false)
const creatingProject = ref(false)
const itemNameSubmitting = ref(false)
const projectFileInputRef = ref(null)
const pendingProjectUploadTarget = ref(null)
const currentUser = ref(null)
const hasUpdateAvailable = ref(false)

const itemNameModalState = ref({
  mode: 'create',
  nodeType: 'markdown',
  workspaceId: null,
  parentId: null,
  item: null,
  title: '新建文件',
  fieldLabel: '文件名称',
  placeholder: '请输入文件名称',
  initialName: '',
  submitText: '创建'
})

const ADMIN_PHONE = '15527109305'
const normalizePhone = phone => String(phone || '').replace(/\D/g, '').slice(-11)
const isSuperAdmin = computed(() => normalizePhone(currentUser.value?.phone) === ADMIN_PHONE)
const showFooterSettings = computed(() => !!currentUser.value)

const {
  masterRecords,
  workspaces,
  activeWorkspace,
  activeItem,
  messages,
  loading,
  sending,
  activeAgentSessionId,
  selectedModel,
  modelOptions,
  loadModelOptions,
  loadMasterRecords,
  loadWorkspaces,
  selectWorkspace,
  selectItem,
  createWorkspace,
  deleteWorkspace,
  createItem,
  uploadFilesToProjectLibrary,
  renameItem,
  deleteItem,
  saveActiveItemContent,
  sendProjectMessage,
  setupAgentListeners
} = useProjectLibrary()

const workspacesWithActiveItems = computed(() => workspaces.value.map(workspace => {
  if (activeWorkspace.value?.id === workspace.id) return activeWorkspace.value
  return workspace
}))

const renderMenuIcon = (iconName) => () => h(Icon, {
  name: iconName,
  size: 16,
  style: 'margin-right: 8px; color: var(--primary-color)'
})

const settingsOptions = computed(() => {
  const options = []

  if (currentUser.value) {
    options.push(
      {
        label: () => h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: '150px',
            lineHeight: '1.25'
          }
        }, [
          h('span', {
            style: {
              fontSize: '12px',
              color: 'var(--text-color-muted)'
            }
          }, '当前账号'),
          h('span', {
            style: {
              marginTop: '3px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: 'var(--text-color)'
            }
          }, currentUser.value.phone)
        ]),
        key: 'account-info',
        icon: renderMenuIcon('user'),
        disabled: true
      },
      { label: '退出登录', key: 'logout', icon: renderMenuIcon('close') }
    )
    options.push({ type: 'divider', key: 'account-divider' })
  }

  if (isSuperAdmin.value) {
    options.push({ label: t('settingsMenu.model'), key: 'model-settings', icon: renderMenuIcon('settings') })
    options.push({ label: t('settingsMenu.imBots'), key: 'im-bot-settings', icon: renderMenuIcon('robot') })
    options.push({ label: t('settingsMenu.projectManagement'), key: 'project-management', icon: renderMenuIcon('folderOpen') })
  }

  if (currentUser.value) {
    options.push({ label: t('settingsMenu.capabilityWorkbench'), key: 'capability-settings', icon: renderMenuIcon('zap') })
  }

  return options
})

const renderSettingsLabel = (option) => {
  if (option.key === 'app-update' && hasUpdateAvailable.value) {
    return h('span', { style: 'display:inline-flex; align-items:center; gap:6px;' }, [
      String(option.label),
      h('span', { style: 'width:7px; height:7px; border-radius:50%; background:#ff4d4f; flex-shrink:0;' })
    ])
  }
  return typeof option.label === 'function' ? option.label() : option.label
}

const reload = async () => {
  await Promise.all([
    loadMasterRecords(),
    loadWorkspaces(),
    loadModelOptions()
  ])
}

const openCreateModal = async () => {
  await loadMasterRecords()
  showCreateModal.value = true
}

const handleCreateWorkspace = async (payload) => {
  creatingProject.value = true
  try {
    await createWorkspace(payload)
    showCreateModal.value = false
    message.success('项目已创建')
  } catch (err) {
    console.error('[ProjectLibrary] Failed to create workspace:', err)
    message.error(err?.message || '创建项目失败')
  } finally {
    creatingProject.value = false
  }
}

const handleDeleteWorkspace = async (workspace) => {
  if (!workspace?.id) return
  dialog.warning({
    title: '删除项目',
    content: `确定删除项目「${workspace.name}」吗？项目内的目录和文件也会一起删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const result = await deleteWorkspace(workspace.id)
        if (result?.success === false) {
          message.error(result.error || '删除项目失败')
          return false
        }
        message.success('项目已删除')
      } catch (err) {
        console.error('[ProjectLibrary] Failed to delete workspace:', err)
        message.error(err?.message || '删除项目失败')
        return false
      }
    }
  })
}

const handleCreateItem = async ({ workspaceId, parentId = null, nodeType }) => {
  try {
    if (workspaceId && activeWorkspace.value?.id !== workspaceId) {
      await selectWorkspace(workspaceId)
    }
    const defaultName = nodeType === 'markdown' ? '新文档.md' : '新文件夹'
    itemNameModalState.value = {
      mode: 'create',
      nodeType,
      workspaceId,
      parentId,
      item: null,
      title: nodeType === 'markdown' ? '新建 Markdown 文件' : '新建文件夹',
      fieldLabel: nodeType === 'markdown' ? 'Markdown 文件名' : '文件夹名称',
      placeholder: nodeType === 'markdown' ? '请输入 Markdown 文件名' : '请输入文件夹名称',
      initialName: defaultName,
      submitText: '创建'
    }
    showItemNameModal.value = true
  } catch (err) {
    console.error('[ProjectLibrary] Failed to create item:', err)
    message.error(err?.message || '创建失败')
  }
}

const openProjectFileUpload = async ({ workspaceId, parentId = null }) => {
  if (!workspaceId) return
  pendingProjectUploadTarget.value = { workspaceId, parentId }
  projectFileInputRef.value?.click()
}

const handleProjectFileUpload = async (event) => {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  const target = pendingProjectUploadTarget.value
  pendingProjectUploadTarget.value = null
  if (!target || files.length === 0) return

  try {
    await uploadFilesToProjectLibrary({
      workspaceId: target.workspaceId,
      parentId: target.parentId,
      files
    })
    message.success(files.length === 1 ? '文件已上传' : '文件已上传')
  } catch (err) {
    console.error('[ProjectLibrary] Failed to upload files:', err)
    message.error(err?.message || '上传文件失败')
  }
}

const normalizeMarkdownDownloadName = (name = '') => {
  const trimmed = String(name || 'project-file.md').trim() || 'project-file.md'
  return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`
}

const downloadMarkdownItem = (item) => {
  if (typeof document === 'undefined') return false
  const blob = new Blob([item?.content || ''], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = normalizeMarkdownDownloadName(item?.name)
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return true
}

const handleDownloadItemFile = (item) => {
  if (item.nodeType === 'markdown') {
    downloadMarkdownItem(item)
    return
  }
  if (!item?.filePath) {
    message.error('文件路径不存在')
    return
  }
  const url = buildFileDownloadUrl({ filePath: item.filePath })
  downloadFileFromUrl(url, item.originalName || item.name)
}

const handleRenameItem = async (item) => {
  if (!item?.id) return
  itemNameModalState.value = {
    mode: 'rename',
    nodeType: item.nodeType,
    workspaceId: activeWorkspace.value?.id || null,
    parentId: item.parentId || null,
    item,
    title: item.nodeType === 'markdown' ? '重命名 Markdown 文件' : '重命名文件夹',
    fieldLabel: item.nodeType === 'markdown' ? 'Markdown 文件名' : '文件夹名称',
    placeholder: item.nodeType === 'markdown' ? '请输入 Markdown 文件名' : '请输入文件夹名称',
    initialName: item.name || '',
    submitText: '保存'
  }
  showItemNameModal.value = true
}

const normalizeItemName = (rawName, nodeType) => {
  const trimmed = String(rawName || '').trim()
  if (!trimmed) return ''
  return nodeType === 'markdown' && !trimmed.endsWith('.md') ? `${trimmed}.md` : trimmed
}

const handleItemNameSubmit = async (rawName) => {
  const state = itemNameModalState.value
  const name = normalizeItemName(rawName, state.nodeType)
  if (!name) return

  itemNameSubmitting.value = true
  try {
    if (state.mode === 'create') {
      await createItem({
        parentId: state.parentId,
        name,
        nodeType: state.nodeType,
        content: ''
      })
      message.success('已创建')
    } else if (state.item?.id) {
      await renameItem({ id: state.item.id, name })
      message.success('已重命名')
    }
    showItemNameModal.value = false
  } catch (err) {
    console.error('[ProjectLibrary] Failed to submit item name:', err)
    message.error(err?.message || (state.mode === 'create' ? '创建失败' : '重命名失败'))
  } finally {
    itemNameSubmitting.value = false
  }
}

const handleDeleteItem = async (item) => {
  if (!item?.id) return
  dialog.warning({
    title: '删除确认',
    content: `确定删除「${item.name}」吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const result = await deleteItem(item.id)
        if (result?.success === false) {
          message.error(result.error || '删除失败')
          return false
        }
        message.success('已删除')
      } catch (err) {
        console.error('[ProjectLibrary] Failed to delete item:', err)
        message.error(err?.message || '删除失败')
        return false
      }
    }
  })
}

const loadCurrentUser = async () => {
  if (!window.electronAPI?.authGetCurrentUser) return
  try {
    const result = await window.electronAPI.authGetCurrentUser()
    currentUser.value = result?.user || null
  } catch (err) {
    currentUser.value = null
  }
}

const handleLogout = async () => {
  if (window.electronAPI?.authLogout) {
    await window.electronAPI.authLogout()
  }
  currentUser.value = null
  redirectToLoginPage()
}

const handleSettingsSelect = async (key) => {
  if (key === 'account-info') return
  if (key === 'logout') {
    await handleLogout()
    return
  }

  if (key === 'model-settings' && !isSuperAdmin.value) return
  if (key === 'im-bot-settings' && !isSuperAdmin.value) return
  if (key === 'project-management' && !isSuperAdmin.value) return
  if (!window.electronAPI) return

  switch (key) {
    case 'model-settings':
      window.electronAPI.openModelSettings?.()
      break
    case 'im-bot-settings':
      window.electronAPI.openIMBotSettings?.()
      break
    case 'project-management':
      if (window.electronAPI.openProjectManagement) {
        window.electronAPI.openProjectManagement()
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'project' } }))
      }
      break
    case 'capability-settings':
      window.electronAPI.openSettingsWorkbench?.()
      break
  }
}

onMounted(async () => {
  setupAgentListeners()
  await loadCurrentUser()
  await reload()
})
</script>

<style scoped>
.project-library-workbench {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 0;
  box-sizing: border-box;
  padding: 0;
  background: var(--bg-color);
}
</style>
