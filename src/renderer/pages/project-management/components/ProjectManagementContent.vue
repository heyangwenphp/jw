<template>
  <div class="project-management">
    <div class="page-header">
      <div>
        <h1>项目管理</h1>
        <p>维护新建项目弹窗中的可选项目主数据。</p>
      </div>
      <div class="header-actions">
        <n-button @click="loadRecords">
          <template #icon>
            <Icon name="refresh" :size="15" />
          </template>
          刷新
        </n-button>
        <n-button type="primary" @click="openCreateModal">
          <template #icon>
            <Icon name="plus" :size="15" />
          </template>
          新建项目
        </n-button>
      </div>
    </div>

    <div class="toolbar">
      <n-input
        v-model:value="keyword"
        class="search-input"
        clearable
        placeholder="搜索项目名称、标签、描述..."
      />
      <n-select
        v-model:value="typeFilter"
        class="filter-select"
        :options="typeFilterOptions"
      />
      <n-select
        v-model:value="statusFilter"
        class="filter-select"
        :options="statusFilterOptions"
      />
    </div>

    <div class="summary-row">
      <div class="summary-card">
        <span class="summary-label">全部</span>
        <strong>{{ records.length }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">启用</span>
        <strong>{{ enabledCount }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">停用</span>
        <strong>{{ disabledCount }}</strong>
      </div>
    </div>

    <div class="table-card">
      <table class="project-table">
        <thead>
          <tr>
            <th>项目名称</th>
            <th>类型</th>
            <th>标签</th>
            <th>默认目录模板</th>
            <th>状态</th>
            <th>排序</th>
            <th>更新时间</th>
            <th class="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in paginatedRecords" :key="record.id">
            <td>
              <div class="record-name">{{ record.name }}</div>
              <div class="record-desc">{{ record.description || '暂无描述' }}</div>
            </td>
            <td>
              <span class="type-pill" :class="`type-${record.type}`">{{ typeText(record.type) }}</span>
            </td>
            <td>
              <div class="tag-list">
                <n-tag v-for="tag in record.tags" :key="tag" size="small">{{ tag }}</n-tag>
                <span v-if="!record.tags?.length" class="muted">-</span>
              </div>
            </td>
            <td>{{ templateSummary(record.templateNodes) }}</td>
            <td>
              <n-switch
                :value="record.enabled"
                @update:value="value => toggleRecord(record, value)"
              />
            </td>
            <td>{{ record.order }}</td>
            <td>{{ formatTime(record.updatedAt) }}</td>
            <td class="actions-col">
              <button class="link-btn" @click="openEditModal(record)">编辑</button>
              <button class="link-btn danger" @click="confirmDelete(record)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="filteredRecords.length === 0" class="empty-state">
        暂无项目主数据
      </div>

      <div v-else-if="filteredRecords.length > pageSize" class="table-pagination">
        <n-pagination
          v-model:page="page"
          :item-count="filteredRecords.length"
          :page-size="pageSize"
          :page-slot="7"
        />
      </div>
    </div>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="editingId ? '编辑项目主数据' : '新建项目主数据'"
      style="width: 620px; max-width: 95vw;"
      :mask-closable="false"
    >
      <n-form :model="form" label-placement="top">
        <n-form-item label="项目名称" required>
          <n-input v-model:value="form.name" placeholder="例如：碳中和" />
        </n-form-item>

        <div class="form-grid">
          <n-form-item label="项目类型" required>
            <n-select v-model:value="form.type" :options="typeOptions" />
          </n-form-item>
          <n-form-item label="状态">
            <n-select v-model:value="form.enabled" :options="enabledOptions" />
          </n-form-item>
        </div>

        <n-form-item label="排序">
          <n-input-number v-model:value="form.order" :min="0" :step="10" style="width: 100%;" />
        </n-form-item>

        <n-form-item label="标签">
          <n-input v-model:value="form.tagsText" placeholder="用 / 分隔，例如：新能源 / 双碳 / 储能" />
        </n-form-item>

        <n-form-item label="项目描述">
          <n-input
            v-model:value="form.description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            maxlength="200"
            show-count
            placeholder="说明该主数据用于哪些项目工作区"
          />
        </n-form-item>

        <n-form-item label="默认目录模板">
          <n-input
            v-model:value="form.templateText"
            type="textarea"
            :autosize="{ minRows: 5, maxRows: 8 }"
            placeholder="每行一个节点，文件夹以 / 结尾，例如：项目概况.md、纪要/"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="saveRecord">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPagination,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import Icon from '@components/icons/Icon.vue'

const defaultRecords = [
  {
    id: 'carbon-neutrality',
    name: '碳中和',
    type: 'track',
    description: '双碳政策、储能、电力市场化、碳交易长期研究方向',
    tags: ['新能源', '双碳', '储能'],
    templateNodes: [
      { name: '项目概况.md', nodeType: 'markdown' },
      { name: 'notes.md', nodeType: 'markdown' },
      { name: '纪要', nodeType: 'folder' },
      { name: '公告', nodeType: 'folder' },
      { name: '其他', nodeType: 'folder' }
    ],
    enabled: true,
    order: 100,
    updatedAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: 'eoptolink',
    name: '新易盛',
    type: 'company',
    description: '高速光模块龙头，跟踪 AI 算力订单和估值兑现',
    tags: ['光模块', 'AI算力'],
    templateNodes: [
      { name: '项目概况.md', nodeType: 'markdown' },
      { name: 'key-driver.md', nodeType: 'markdown' },
      { name: '纪要', nodeType: 'folder' },
      { name: '公告', nodeType: 'folder' },
      { name: '其他', nodeType: 'folder' }
    ],
    enabled: true,
    order: 200,
    updatedAt: '2026-06-01T00:00:00.000Z'
  },
  {
    id: 'tsinghua-ai-hardware',
    name: '清华系早期 AI 硬件',
    type: 'topic',
    description: '清华系创业机会、早期硬件项目和教授实验室线索',
    tags: ['清华', '硬件', '早期'],
    templateNodes: [
      { name: '项目概况.md', nodeType: 'markdown' },
      { name: 'notes.md', nodeType: 'markdown' },
      { name: '纪要', nodeType: 'folder' },
      { name: '公告', nodeType: 'folder' },
      { name: '其他', nodeType: 'folder' }
    ],
    enabled: true,
    order: 300,
    updatedAt: '2026-06-01T00:00:00.000Z'
  }
]

const typeOptions = [
  { label: '赛道', value: 'track' },
  { label: '公司', value: 'company' },
  { label: '专题', value: 'topic' },
  { label: '自定义', value: 'custom' }
]

const typeFilterOptions = [
  { label: '全部类型', value: 'all' },
  ...typeOptions
]

const statusFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' }
]

const enabledOptions = [
  { label: '启用', value: true },
  { label: '停用', value: false }
]

const message = useMessage()
const dialog = useDialog()
const records = ref([])
const keyword = ref('')
const typeFilter = ref('all')
const statusFilter = ref('all')
const showModal = ref(false)
const editingId = ref('')
const page = ref(1)
const pageSize = 10

const form = reactive({
  name: '',
  type: 'track',
  description: '',
  tagsText: '',
  templateText: '项目概况.md\nnotes.md\n纪要/\n公告/\n其他/',
  enabled: true,
  order: 100
})

const normalizeRecords = (items) => {
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item && typeof item === 'object' && item.name)
    .map(item => ({
      id: item.id || `project-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: String(item.name || '').trim(),
      type: ['track', 'company', 'topic', 'custom'].includes(item.type) ? item.type : 'custom',
      description: String(item.description || '').trim(),
      tags: Array.isArray(item.tags) ? item.tags.map(tag => String(tag).trim()).filter(Boolean) : [],
      templateNodes: Array.isArray(item.templateNodes) ? item.templateNodes : [],
      enabled: item.enabled !== false,
      order: Number.isFinite(Number(item.sortOrder ?? item.order)) ? Number(item.sortOrder ?? item.order) : 100,
      updatedAt: item.updatedAt || new Date().toISOString()
    }))
}

const typeText = (type) => typeOptions.find(option => option.value === type)?.label || '自定义'
const templateSummary = (nodes = []) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return '-'
  const files = nodes.filter(node => node.nodeType === 'markdown').length
  const folders = nodes.filter(node => node.nodeType === 'folder').length
  return `${files} 个文档 / ${folders} 个文件夹`
}

const enabledCount = computed(() => records.value.filter(record => record.enabled).length)
const disabledCount = computed(() => records.value.length - enabledCount.value)

const filteredRecords = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return [...records.value]
    .filter(record => typeFilter.value === 'all' || record.type === typeFilter.value)
    .filter(record => {
      if (statusFilter.value === 'enabled') return record.enabled
      if (statusFilter.value === 'disabled') return !record.enabled
      return true
    })
    .filter(record => {
      if (!text) return true
      return [
        record.name,
        record.description,
        ...(record.tags || [])
      ].join(' ').toLowerCase().includes(text)
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-CN'))
})

const pageCount = computed(() => Math.max(1, Math.ceil(filteredRecords.value.length / pageSize)))

const paginatedRecords = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredRecords.value.slice(start, start + pageSize)
})

watch([keyword, typeFilter, statusFilter], () => {
  page.value = 1
})

watch(pageCount, count => {
  if (page.value > count) page.value = count
})

const loadRecords = async () => {
  try {
    const stored = await window.electronAPI?.listProjectMasterRecords?.({ all: true })
    records.value = normalizeRecords(stored)
  } catch (err) {
    console.error('[ProjectManagement] Failed to load records:', err)
    records.value = []
    message.error('加载项目主数据失败')
  }
}

const resetForm = () => {
  editingId.value = ''
  Object.assign(form, {
    name: '',
    type: 'track',
    description: '',
    tagsText: '',
    templateText: '项目概况.md\nnotes.md\n纪要/\n公告/\n其他/',
    enabled: true,
    order: Math.max(0, ...records.value.map(record => Number(record.order) || 0)) + 10
  })
}

const openCreateModal = () => {
  resetForm()
  showModal.value = true
}

const openEditModal = (record) => {
  editingId.value = record.id
  Object.assign(form, {
    name: record.name,
    type: record.type,
    description: record.description || '',
    tagsText: (record.tags || []).join(' / '),
    templateText: serializeTemplateNodes(record.templateNodes),
    enabled: record.enabled !== false,
    order: Number(record.order) || 100
  })
  showModal.value = true
}

const parseTags = (value) => String(value || '')
  .split(/[\/,，、]/)
  .map(tag => tag.trim())
  .filter(Boolean)

const parseTemplateNodes = (value) => String(value || '')
  .split(/\r?\n/)
  .map((line, index) => {
    const raw = line.trim()
    if (!raw) return null
    const isFolder = raw.endsWith('/')
    const name = isFolder ? raw.replace(/\/+$/, '') : raw
    if (!name) return null
    return {
      name,
      nodeType: isFolder ? 'folder' : 'markdown',
      sortOrder: index,
      content: isFolder ? '' : ''
    }
  })
  .filter(Boolean)

const serializeTemplateNodes = (nodes = []) => (Array.isArray(nodes) ? nodes : [])
  .map(node => `${node.name}${node.nodeType === 'folder' ? '/' : ''}`)
  .join('\n')

const normalizeProjectName = value => String(value || '').trim().toLocaleLowerCase()

const buildRecordFromForm = () => ({
  id: editingId.value || `project-${Date.now()}`,
  name: form.name.trim(),
  type: form.type,
  description: form.description.trim(),
  tags: parseTags(form.tagsText),
  templateNodes: parseTemplateNodes(form.templateText),
  enabled: form.enabled !== false,
  sortOrder: Number(form.order) || 0,
  updatedAt: new Date().toISOString()
})

const saveRecord = async () => {
  if (!form.name.trim()) {
    message.warning('请输入项目名称')
    return
  }

  const record = buildRecordFromForm()
  const exists = records.value.some(item => normalizeProjectName(item.name) === normalizeProjectName(record.name) && item.id !== record.id)
  if (exists) {
    message.warning('项目已存在')
    return
  }

  try {
    if (editingId.value) {
      await window.electronAPI.updateProjectMasterRecord({ id: editingId.value, updates: record })
    } else {
      await window.electronAPI.createProjectMasterRecord(record)
    }
    await loadRecords()
    showModal.value = false
    message.success('项目主数据已保存')
  } catch (err) {
    console.error('[ProjectManagement] Failed to save record:', err)
    message.error(err?.message || '保存失败')
  }
}

const toggleRecord = async (record, enabled) => {
  try {
    await window.electronAPI.updateProjectMasterRecord({ id: record.id, updates: { enabled } })
    await loadRecords()
  } catch (err) {
    console.error('[ProjectManagement] Failed to toggle record:', err)
    message.error('状态保存失败')
    await loadRecords()
  }
}

const confirmDelete = (record) => {
  dialog.warning({
    title: '删除项目主数据',
    content: `确认删除「${record.name}」？已创建的项目工作区不会被删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      records.value = records.value.filter(item => item.id !== record.id)
      try {
        await window.electronAPI.deleteProjectMasterRecord(record.id)
        await loadRecords()
        message.success('已删除')
      } catch (err) {
        console.error('[ProjectManagement] Failed to delete record:', err)
        message.error('删除失败')
        await loadRecords()
      }
    }
  })
}

const formatTime = (value) => {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleDateString('zh-CN')
  } catch {
    return '-'
  }
}

onMounted(loadRecords)
</script>

<style scoped>
.project-management {
  min-height: 100%;
  padding: 20px 24px;
  background: var(--bg-color);
  color: var(--text-color);
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
}

.page-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-color-muted);
}

.header-actions,
.toolbar,
.summary-row,
.tag-list {
  display: flex;
  align-items: center;
}

.header-actions {
  gap: 8px;
}

.toolbar {
  gap: 10px;
  margin-bottom: 14px;
}

.search-input {
  max-width: 420px;
}

.filter-select {
  width: 130px;
}

.summary-row {
  gap: 10px;
  margin-bottom: 14px;
}

.summary-card {
  min-width: 100px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
}

.summary-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-color-muted);
}

.summary-card strong {
  font-size: 20px;
}

.table-card {
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
}

.project-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.project-table th,
.project-table td {
  padding: 13px 14px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  vertical-align: middle;
  font-size: 13px;
}

.project-table th {
  background: var(--bg-color-secondary);
  color: var(--text-color-secondary);
  font-weight: 600;
}

.project-table tr:last-child td {
  border-bottom: none;
}

.record-name {
  margin-bottom: 5px;
  font-weight: 700;
  color: var(--text-color);
}

.record-desc {
  overflow: hidden;
  color: var(--text-color-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.type-track {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.type-company {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.type-topic {
  background: rgba(217, 119, 6, 0.14);
  color: #b45309;
}

.type-custom {
  background: rgba(124, 58, 237, 0.13);
  color: #7c3aed;
}

.tag-list {
  flex-wrap: wrap;
  gap: 6px;
}

.muted {
  color: var(--text-color-muted);
}

.actions-col {
  width: 140px;
  text-align: right;
}

.project-table td.actions-col {
  white-space: nowrap;
}

.project-table td.actions-col .link-btn + .link-btn {
  margin-left: 10px;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 12px 14px;
  border-top: 1px solid var(--border-color);
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 13px;
}

.link-btn.danger {
  color: var(--danger-color);
}

.empty-state {
  padding: 48px 0;
  text-align: center;
  color: var(--text-color-muted);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 820px) {
  .page-header,
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search-input,
  .filter-select {
    width: 100%;
    max-width: none;
  }

  .table-card {
    overflow-x: auto;
  }

  .project-table {
    min-width: 920px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
