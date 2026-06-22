<template>
  <div class="project-tree">
    <div
      v-for="workspace in workspaces"
      :key="workspace.id"
      class="workspace-block"
    >
      <div
        class="tree-row workspace-row"
        :class="{ active: activeWorkspaceId === workspace.id && !activeItemId }"
        @click="$emit('select-workspace', workspace.id)"
      >
        <button class="toggle-btn" type="button" @click.stop="toggle(workspace.id)">
          <Icon :name="expandedIds.has(workspace.id) ? 'chevronDown' : 'chevronRight'" :size="13" />
        </button>
        <Icon name="folder" :size="14" class="node-icon folder" />
        <span class="row-title">{{ workspace.name }}</span>
        <RowActionMenu :actions="workspaceActions(workspace)" />
      </div>

      <div v-if="expandedIds.has(workspace.id)" class="workspace-children">
        <TreeNode
          v-for="item in rootItems(workspace)"
          :key="item.id"
          :item="item"
          :items="workspace.items || []"
          :active-item-id="activeItemId"
          :depth="0"
          @select="$emit('select-item', $event)"
          @create-item="$emit('create-item', $event)"
          @upload-file="$emit('upload-file', $event)"
          @download-file="$emit('download-file', $event)"
          @rename-item="$emit('rename-item', $event)"
          @delete-item="$emit('delete-item', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { h, onBeforeUnmount, ref, Teleport, watch } from 'vue'
import Icon from '@components/icons/Icon.vue'
import { reconcileWorkspaceExpansion } from './project-tree-state.js'

const MENU_CLOSE_DELAY_MS = 160

const props = defineProps({
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
  }
})

const emit = defineEmits(['select-workspace', 'select-item', 'create-item', 'upload-file', 'download-file', 'rename-item', 'delete-item', 'delete-workspace'])

const expandedIds = ref(new Set())
const hasInitializedExpansion = ref(false)

watch(() => props.workspaces, (workspaces) => {
  const result = reconcileWorkspaceExpansion({
    workspaces,
    expandedIds: expandedIds.value,
    initialized: hasInitializedExpansion.value
  })
  expandedIds.value = result.expandedIds
  hasInitializedExpansion.value = result.initialized
}, { immediate: true })

const toggle = (id) => {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

const rootItems = (workspace) => (workspace.items || []).filter(item => !item.parentId)
const isDownloadableItem = (item) => ['file', 'markdown'].includes(item?.nodeType)

const workspaceActions = (workspace) => [
  { icon: 'folder', label: '新建文件夹', title: '新建文件夹', onClick: () => emit('create-item', { workspaceId: workspace.id, parentId: null, nodeType: 'folder' }) },
  { icon: 'fileText', label: '新建文件', title: '新建 Markdown', onClick: () => emit('create-item', { workspaceId: workspace.id, parentId: null, nodeType: 'markdown' }) },
  { icon: 'upload', label: '上传文件', title: '上传文件', onClick: () => emit('upload-file', { workspaceId: workspace.id, parentId: null, nodeType: 'file' }) },
  { icon: 'trash', label: '删除', title: '删除项目', danger: true, onClick: () => emit('delete-workspace', workspace) }
]

const RowActionMenu = {
  name: 'ProjectLibraryRowActionMenu',
  props: {
    actions: {
      type: Array,
      default: () => []
    }
  },
  setup(props) {
    const open = ref(false)
    const menuStyle = ref({})
    const triggerRef = ref(null)
    const menuRef = ref(null)
    let closeTimer = null

    const clearCloseTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    const showMenu = (event) => {
      clearCloseTimer()
      const rect = event.currentTarget.getBoundingClientRect()
      menuStyle.value = {
        top: `${rect.top}px`,
        left: `${rect.right}px`
      }
      open.value = true
    }

    const isElementHovered = (element) => {
      try {
        return !!element?.matches?.(':hover')
      } catch {
        return false
      }
    }

    const isHoveringActionSurface = () => {
      return isElementHovered(triggerRef.value) || isElementHovered(menuRef.value)
    }

    const scheduleClose = () => {
      clearCloseTimer()
      closeTimer = setTimeout(() => {
        if (isHoveringActionSurface()) return
        open.value = false
      }, MENU_CLOSE_DELAY_MS)
    }

    const runAction = (event, action) => {
      event.stopPropagation()
      open.value = false
      action.onClick(event)
    }

    onBeforeUnmount(clearCloseTimer)

    return () => h('div', {
      class: 'row-action-wrap',
      onClick: event => event.stopPropagation(),
      onMouseenter: clearCloseTimer,
      onMouseleave: scheduleClose
    }, [
      h('button', {
        ref: triggerRef,
        class: 'row-action-trigger',
        title: '更多操作',
        type: 'button',
        tabindex: -1,
        onFocus: showMenu,
        onMouseenter: showMenu,
        onMouseleave: scheduleClose
      }, [h(Icon, { name: 'moreHorizontal', size: 14 })]),
      h(Teleport, { to: 'body' }, open.value
        ? h('div', {
          ref: menuRef,
          class: 'project-tree-action-menu row-action-menu',
          role: 'menu',
          style: menuStyle.value,
          onClick: event => event.stopPropagation(),
          onMouseenter: clearCloseTimer,
          onMouseleave: scheduleClose
        }, props.actions.filter(Boolean).map(action => h('button', {
          class: ['project-tree-action-menu-item', 'row-action-menu-item', action.danger ? 'danger' : ''],
          title: action.title,
          type: 'button',
          onClick: event => runAction(event, action)
        }, [
          h(Icon, { name: action.icon, size: 13 }),
          h('span', action.label)
        ])))
        : null)
    ])
  }
}

const TreeNode = {
  name: 'ProjectLibraryTreeNode',
  props: {
    item: { type: Object, required: true },
    items: { type: Array, default: () => [] },
    activeItemId: { type: Number, default: null },
    depth: { type: Number, default: 0 }
  },
  emits: ['select', 'create-item', 'upload-file', 'download-file', 'rename-item', 'delete-item'],
  setup(props, { emit }) {
    const expanded = ref(true)
    const children = () => props.items.filter(item => item.parentId === props.item.id)
    const hasChildren = () => children().length > 0
    const onCreate = (nodeType) => emit('create-item', {
      workspaceId: props.item.workspaceId,
      parentId: props.item.id,
      nodeType
    })
    const onUpload = () => emit('upload-file', {
      workspaceId: props.item.workspaceId,
      parentId: props.item.id,
      nodeType: 'file'
    })
    const stopAndEmit = (event, name, payload) => {
      event.stopPropagation()
      emit(name, payload)
    }

    return () => h('div', { class: 'tree-node' }, [
      h('div', {
        class: [
          'tree-row',
          props.item.nodeType === 'folder' ? 'folder-row' : 'file-row',
          props.activeItemId === props.item.id ? 'active' : ''
        ],
        style: { paddingLeft: `${props.depth * 18 + 8}px` },
        onClick: () => emit('select', props.item)
      }, [
        props.item.nodeType === 'folder'
          ? h('button', {
            class: 'toggle-btn',
            type: 'button',
            onClick: (event) => {
              event.stopPropagation()
              expanded.value = !expanded.value
            }
          }, [h(Icon, { name: expanded.value ? 'chevronDown' : 'chevronRight', size: 13 })])
          : h('span', { class: 'toggle-spacer' }),
        h(Icon, {
          name: props.item.nodeType === 'folder' ? 'folder' : 'fileText',
          size: 14,
          class: ['node-icon', props.item.nodeType === 'folder' ? 'folder' : 'markdown']
        }),
        h('span', { class: 'row-title' }, props.item.name),
        h(RowActionMenu, {
          actions: [
          isDownloadableItem(props.item)
            ? { icon: 'download', label: '下载', title: '下载', onClick: event => stopAndEmit(event, 'download-file', props.item) }
            : null,
          props.item.nodeType === 'folder'
            ? { icon: 'folder', label: '新建文件夹', title: '新建文件夹', onClick: () => onCreate('folder') }
            : null,
          props.item.nodeType === 'folder'
            ? { icon: 'fileText', label: '新建文件', title: '新建 Markdown', onClick: () => onCreate('markdown') }
            : null,
          props.item.nodeType === 'folder'
            ? { icon: 'upload', label: '上传文件', title: '上传文件', onClick: () => onUpload() }
            : null,
          { icon: 'edit', label: '重命名', title: '重命名', onClick: event => stopAndEmit(event, 'rename-item', props.item) },
          {
            icon: 'trash',
            label: '删除',
            title: props.item.nodeType === 'folder' && hasChildren() ? '删除（需先清空文件夹）' : '删除',
            danger: true,
            onClick: event => stopAndEmit(event, 'delete-item', props.item)
          }
          ]
        })
      ]),
      props.item.nodeType === 'folder' && expanded.value
        ? children().map(child => h(TreeNode, {
          key: child.id,
          item: child,
          items: props.items,
          activeItemId: props.activeItemId,
          depth: props.depth + 1,
          onSelect: value => emit('select', value),
          onCreateItem: value => emit('create-item', value),
          onUploadFile: value => emit('upload-file', value),
          onDownloadFile: value => emit('download-file', value),
          onRenameItem: value => emit('rename-item', value),
          onDeleteItem: value => emit('delete-item', value)
        }))
        : null
    ])
  }
}
</script>

<style scoped>
.project-tree {
  padding: 0 0 16px;
}

.workspace-block {
  margin-bottom: 8px;
}

.tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  border-radius: 8px;
  padding: 0 9px;
  margin: 2px 0;
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  overflow: visible;
  transition: background 0.16s ease, color 0.16s ease;
}

.tree-row:hover,
.tree-row.active {
  background: var(--selected-bg);
  color: var(--primary-color);
  z-index: 8;
}

.workspace-row {
  font-weight: 650;
  color: var(--text-color);
}

.workspace-children {
  margin-left: 13px;
  padding-left: 8px;
}

.toggle-btn,
.row-action-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.toggle-spacer {
  width: 22px;
  flex: 0 0 22px;
}

.row-action-wrap {
  position: relative;
  flex: 0 0 22px;
  margin-left: 0;
}

.row-action-trigger {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.tree-row:hover .row-action-trigger,
.tree-row.active .row-action-trigger,
.row-action-wrap:hover .row-action-trigger {
  opacity: 0.72;
  visibility: visible;
}

.row-action-trigger:hover,
.row-action-wrap:hover .row-action-trigger {
  opacity: 1;
  background: var(--hover-bg);
}

.row-action-menu {
  position: fixed;
  z-index: 2000;
  display: grid;
  min-width: 138px;
  gap: 2px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 6px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
}

.row-action-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.row-action-menu-item:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.row-action-menu-item.danger {
  color: #d93026;
}

.row-action-menu-item.danger:hover {
  background: rgba(217, 48, 38, 0.08);
}

.row-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-row .row-title,
.workspace-row .row-title {
  font-weight: 650;
}

.file-row .row-title {
  font-weight: 400;
}

.node-icon {
  flex-shrink: 0;
}

.node-icon.folder {
  color: #d08a00;
}

.node-icon.markdown {
  color: #2f7df6;
}
</style>

<style>
.project-tree .tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  border-radius: 8px;
  padding: 0 9px;
  margin: 2px 0;
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  overflow: visible;
  transition: background 0.16s ease, color 0.16s ease;
}

.project-tree .tree-row:hover,
.project-tree .tree-row.active {
  background: var(--selected-bg);
  color: var(--primary-color);
  z-index: 8;
}

.project-tree .folder-row .row-title,
.project-tree .workspace-row .row-title {
  font-weight: 650;
}

.project-tree .file-row .row-title {
  font-weight: 400;
}

.project-tree .node-icon {
  flex-shrink: 0;
}

.project-tree .node-icon.folder {
  color: #d08a00;
}

.project-tree .node-icon.markdown {
  color: #2f7df6;
}

.project-tree .row-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-tree .toggle-btn,
.project-tree .row-action-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.project-tree .row-action-wrap {
  position: relative;
  flex: 0 0 22px;
  margin-left: 0;
}

.project-tree .row-action-trigger {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.project-tree .tree-row:hover .row-action-trigger,
.project-tree .tree-row.active .row-action-trigger,
.project-tree .row-action-wrap:hover .row-action-trigger {
  opacity: 0.72;
  visibility: visible;
}

.project-tree .row-action-trigger:hover,
.project-tree .row-action-wrap:hover .row-action-trigger {
  opacity: 1;
  background: var(--hover-bg);
}

.project-tree-action-menu {
  position: fixed;
  z-index: 2000;
  display: grid;
  min-width: 138px;
  gap: 2px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 6px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
}

.project-tree-action-menu::before {
  content: '';
  position: absolute;
  top: 0;
  left: -16px;
  width: 16px;
  height: 100%;
  pointer-events: auto;
}

.project-tree-action-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
}

.project-tree-action-menu-item:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.project-tree-action-menu-item.danger {
  color: #d93026;
}

.project-tree-action-menu-item.danger:hover {
  background: rgba(217, 48, 38, 0.08);
}

.project-tree .toggle-spacer {
  width: 22px;
  flex: 0 0 22px;
}
</style>
