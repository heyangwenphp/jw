<template>
  <div class="midea-monitor-content">
    <div class="header-row">
      <div>
        <div class="title-line">美的舆情监控</div>
        <div class="subtitle">共 {{ totalItems }} 条数据，{{ summary.processFailed }} 条处理失败，{{ summary.pushFailed }} 条推送失败</div>
      </div>
      <div class="header-actions">
        <select v-model="statusFilter" class="status-select" :disabled="loading" @change="handleStatusChange">
          <option value="">全部处理状态</option>
          <option value="received">已接收</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
        </select>
        <select v-model="pushStatusFilter" class="status-select" :disabled="loading" @change="handleStatusChange">
          <option value="">全部推送状态</option>
          <option value="none">未推送</option>
          <option value="pending">待推送</option>
          <option value="sending">推送中</option>
          <option value="success">推送成功</option>
          <option value="failed">推送失败</option>
        </select>
        <select v-model="pushFlagFilter" class="status-select" :disabled="loading" @change="handleStatusChange">
          <option value="">全部推送标识</option>
          <option value="none">未标识</option>
          <option value="推送">推送</option>
          <option value="不推送">不推送</option>
          <option value="重复">重复</option>
        </select>
        <input
          v-model="publishStartFilter"
          class="status-select date-input"
          type="datetime-local"
          :disabled="loading"
          aria-label="发布时间开始"
          title="发布时间开始"
          @change="handleStatusChange"
        />
        <input
          v-model="publishEndFilter"
          class="status-select date-input"
          type="datetime-local"
          :disabled="loading"
          aria-label="发布时间结束"
          title="发布时间结束"
          @change="handleStatusChange"
        />
        <n-button size="small" secondary :loading="loading" @click="loadItems">
          <template #icon><Icon name="refresh" :size="14" /></template>
          刷新
        </n-button>
      </div>
    </div>

    <div class="summary-grid">
      <div v-for="summary in summaryItems" :key="summary.label" class="summary-item">
        <span class="summary-value">{{ summary.value }}</span>
        <span class="summary-label">{{ summary.label }}</span>
      </div>
    </div>

    <div v-if="error" class="state-box error-box">{{ error }}</div>

    <div v-if="loading && !items.length" class="state-box">
      <Icon name="refresh" :size="18" class="spin" />
      <span>正在加载舆情数据</span>
    </div>

    <div v-else-if="!items.length" class="state-box">
      <span>暂无舆情数据</span>
    </div>

    <div v-else class="list-area">
      <div class="table-shell">
        <table class="push-table">
          <thead>
            <tr>
              <th>推送时间</th>
              <th>article_id</th>
              <th>标题</th>
              <th>平台</th>
              <th>发布时间</th>
              <th>情感属性</th>
              <th>推送标识</th>
              <th>完整标签</th>
              <th>摘要</th>
              <th>投诉编号</th>
              <th>AI总结</th>
              <th>AI研判</th>
              <th>推送状态</th>
              <th>处理状态</th>
              <th>进度/错误</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.itemId">
              <td>{{ formatDateTime(item.pushTime || item.receivedAt || item.createdAt) }}</td>
              <td><span class="mono" :title="item.article_id || item.articleId || ''">{{ item.article_id || item.articleId || '-' }}</span></td>
              <td><span class="title-text" :title="item.newsTitle || ''">{{ item.newsTitle || '-' }}</span></td>
              <td>{{ item.platformName || '-' }}</td>
              <td>{{ item.newsPosttime || '-' }}</td>
              <td><span class="cell-text" :title="item.newsEmotion || ''">{{ item.newsEmotion || '-' }}</span></td>
              <td><span class="cell-text" :title="item.pushFlag || ''">{{ item.pushFlag || '-' }}</span></td>
              <td><span class="cell-text" :title="item.fullLabel || ''">{{ item.fullLabel || '-' }}</span></td>
              <td><span class="cell-text" :title="item.summary || ''">{{ item.summary || '-' }}</span></td>
              <td><span class="cell-text" :title="item.complaintNo || ''">{{ item.complaintNo || '-' }}</span></td>
              <td><span class="cell-text" :title="item.aiSummary || ''">{{ item.aiSummary || '-' }}</span></td>
              <td><span class="cell-text" :title="item.aiJudgement || ''">{{ item.aiJudgement || '-' }}</span></td>
              <td>
                <span v-if="item.pushStatus" class="status-badge" :class="`status-${item.pushStatus}`">
                  {{ pushStatusText(item.pushStatus) }}
                </span>
                <span v-else>-</span>
              </td>
              <td>
                <span class="status-badge" :class="`status-${item.status}`">
                  {{ statusText(item.status) }}
                </span>
              </td>
              <td><span class="error-text" :title="item.error || item.pushError || progressText(item)">{{ item.error || item.pushError || progressText(item) }}</span></td>
              <td>
                <div class="row-actions">
                  <button class="text-btn primary" @click="openDetail(item)">查看</button>
                  <button
                    class="text-btn"
                    :disabled="processingItemId === item.itemId || item.status === 'processing'"
                    @click="processItem(item)"
                  >
                    {{ processButtonText(item) }}
                  </button>
                  <button
                    v-if="canPushItem(item)"
                    class="text-btn primary"
                    :disabled="pushingItemId === item.itemId"
                    @click="pushItem(item)"
                  >
                    {{ pushButtonText(item) }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pagination-row">
        <div class="pagination-info">
          第 {{ currentPage }} / {{ totalPages }} 页，共 {{ totalItems }} 条数据，每页 {{ pageSize }} 条
        </div>
        <div class="pagination-actions">
          <select v-model.number="pageSize" class="status-select page-size-select" :disabled="loading" @change="handlePageSizeChange">
            <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }} 条/页</option>
          </select>
          <n-button size="small" secondary :disabled="loading || currentPage <= 1" @click="goToPage(currentPage - 1)">
            上一页
          </n-button>
          <n-button size="small" secondary :disabled="loading || currentPage >= totalPages" @click="goToPage(currentPage + 1)">
            下一页
          </n-button>
        </div>
      </div>
    </div>

    <n-modal v-model:show="showDetail" @update:show="handleDetailVisibleChange">
      <div class="detail-modal">
        <div class="detail-header">
          <div>
            <div class="detail-title">舆情数据详情</div>
            <div class="detail-subtitle">{{ selectedItem?.itemId }}</div>
          </div>
          <n-button size="small" @click="showDetail = false">关闭</n-button>
        </div>

        <template v-if="selectedItem">
          <div class="detail-meta">
            <div><span>推送时间</span><strong>{{ formatDateTime(selectedItem.pushTime || selectedItem.receivedAt) }}</strong></div>
            <div><span>平台</span><strong>{{ selectedItem.platformName || '-' }}</strong></div>
            <div><span>处理状态</span><strong>{{ statusText(selectedItem.status) }}</strong></div>
            <div><span>推送状态</span><strong>{{ pushStatusText(selectedItem.pushStatus) }}</strong></div>
            <div><span>article_id</span><strong>{{ selectedItem.article_id || selectedItem.articleId || '-' }}</strong></div>
            <div><span>技能</span><strong>{{ selectedItem.skillId || 'midea-yq-alert' }}</strong></div>
          </div>
          <div v-if="detailLoading" class="detail-loading">正在加载详情...</div>
          <pre class="json-preview">{{ previewJson }}</pre>
        </template>
      </div>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { NButton, NModal, useMessage } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'

const items = ref([])
const loading = ref(false)
const error = ref('')
const statusFilter = ref('')
const pushStatusFilter = ref('')
const pushFlagFilter = ref('')
const publishStartFilter = ref('')
const publishEndFilter = ref('')
const showDetail = ref(false)
const selectedItem = ref(null)
const detailLoading = ref(false)
const processingItemId = ref(null)
const pushingItemId = ref(null)
const totalItems = ref(0)
const pageSize = ref(20)
const currentPage = ref(1)
const pageSizeOptions = [20, 40, 60, 80, 100]
const summary = ref({
  total: 0,
  pending: 0,
  processing: 0,
  pushed: 0,
  processFailed: 0,
  pushFailed: 0,
  pushFlagPush: 0,
  emotionPositive: 0,
  emotionNegative: 0
})
const message = useMessage()
const processedFieldKeys = new Set([
  'summary',
  'optimizedSummary',
  'complaintNo',
  'aiSummary',
  'aiJudgement',
  'aiJudgment',
  'pushFlag',
  'fullLabel'
])

const hasValue = value => value !== undefined && value !== null && value !== ''

const mergeItemPatch = (base = {}, patch = {}) => {
  const next = { ...base }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue
    if (processedFieldKeys.has(key) && !hasValue(value) && hasValue(base[key])) continue
    next[key] = value
  }
  return next
}

const firstValue = (...values) => values.find(hasValue) || ''
const toSummaryNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const getItemEmotion = item => String(firstValue(item.newsEmotion, item.data?.news_emotion, item.data?.newsEmotion)).trim()
const isPositiveEmotion = item => {
  const emotion = getItemEmotion(item)
  return emotion === '正面' || emotion.toLowerCase() === 'positive'
}
const isNegativeEmotion = item => {
  const emotion = getItemEmotion(item)
  return emotion === '负面' || emotion.toLowerCase() === 'negative'
}

const apiGet = async path => {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

const apiPost = async path => {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

const listItems = async () => {
  const options = {
    status: statusFilter.value,
    pushStatus: pushStatusFilter.value,
    pushFlag: pushFlagFilter.value,
    publishStart: publishStartFilter.value,
    publishEnd: publishEndFilter.value,
    page: currentPage.value,
    pageSize: pageSize.value
  }
  if (window.electronAPI?.listMideaYqItems) {
    return window.electronAPI.listMideaYqItems(options)
  }
  const query = new URLSearchParams()
  if (options.status) query.set('status', options.status)
  if (options.pushStatus) query.set('pushStatus', options.pushStatus)
  if (options.pushFlag) query.set('pushFlag', options.pushFlag)
  if (options.publishStart) query.set('publishStart', options.publishStart)
  if (options.publishEnd) query.set('publishEnd', options.publishEnd)
  query.set('page', String(options.page))
  query.set('pageSize', String(options.pageSize))
  return apiGet(`/api/aipin-data/admin/items?${query.toString()}`)
}

const processMideaItem = async itemId => {
  if (window.electronAPI?.processMideaYqItem) {
    return window.electronAPI.processMideaYqItem(itemId)
  }
  return apiPost(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/process`)
}

const pushMideaItem = async itemId => {
  if (window.electronAPI?.pushMideaYqItem) {
    return window.electronAPI.pushMideaYqItem(itemId)
  }
  return apiPost(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/push`)
}

const getMideaItemDetail = async itemId => {
  if (window.electronAPI?.getMideaYqItemDetail) {
    return window.electronAPI.getMideaYqItemDetail(itemId)
  }
  return apiGet(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}`)
}

const mergeLoadedItems = nextItems => {
  const previousById = new Map(items.value.map(item => [item.itemId, item]))
  return nextItems.map(item => {
    if (!item?.itemId || !previousById.has(item.itemId)) return item
    return mergeItemPatch(previousById.get(item.itemId), item)
  })
}

const loadItems = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await listItems()
    const nextItems = Array.isArray(result?.items) ? result.items : []
    items.value = mergeLoadedItems(nextItems)
    totalItems.value = Number.isFinite(Number(result?.total)) ? Number(result.total) : items.value.length
    currentPage.value = Number.isFinite(Number(result?.page)) ? Number(result.page) : currentPage.value
    pageSize.value = Number.isFinite(Number(result?.pageSize)) ? Number(result.pageSize) : pageSize.value
    summary.value = {
      total: toSummaryNumber(result?.summary?.total, totalItems.value),
      pending: toSummaryNumber(result?.summary?.pending, items.value.filter(item => item.status === 'received' || item.status === 'pending').length),
      processing: toSummaryNumber(result?.summary?.processing, items.value.filter(item => item.status === 'processing').length),
      pushed: toSummaryNumber(result?.summary?.pushed, items.value.filter(item => item.pushStatus === 'success').length),
      processFailed: toSummaryNumber(result?.summary?.processFailed, items.value.filter(item => item.status === 'failed').length),
      pushFailed: toSummaryNumber(result?.summary?.pushFailed, items.value.filter(item => item.pushStatus === 'failed').length),
      pushFlagPush: toSummaryNumber(result?.summary?.pushFlagPush, items.value.filter(item => item.pushFlag === '推送').length),
      emotionPositive: toSummaryNumber(result?.summary?.emotionPositive, items.value.filter(isPositiveEmotion).length),
      emotionNegative: toSummaryNumber(result?.summary?.emotionNegative, items.value.filter(isNegativeEmotion).length)
    }
    const maxPage = Math.max(1, Math.ceil(totalItems.value / pageSize.value))
    if (currentPage.value > maxPage) {
      currentPage.value = maxPage
      await loadItems()
    }
  } catch (err) {
    error.value = err.message || '加载舆情数据失败'
    items.value = []
    totalItems.value = 0
    summary.value = {
      total: 0,
      pending: 0,
      processing: 0,
      pushed: 0,
      processFailed: 0,
      pushFailed: 0,
      pushFlagPush: 0,
      emotionPositive: 0,
      emotionNegative: 0
    }
  } finally {
    loading.value = false
  }
}

const updateItem = (itemId, patch) => {
  const index = items.value.findIndex(item => item.itemId === itemId)
  if (index < 0) return
  items.value[index] = mergeItemPatch(items.value[index], patch)
  if (selectedItem.value?.itemId === itemId) {
    selectedItem.value = mergeItemPatch(selectedItem.value, patch)
  }
}

const markItemProcessing = item => {
  updateItem(item.itemId, {
    status: 'processing',
    error: '',
    skillId: 'midea-yq-alert'
  })
}

const applyTaskToItem = (itemId, task = {}) => {
  updateItem(itemId, {
    taskId: task.taskId || null,
    skillId: task.skillId || 'midea-yq-alert',
    status: task.status || 'processing',
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    sessionId: task.sessionId || null,
    outputDir: task.outputDir || null,
    resultFile: task.resultFile || null,
    error: task.error || null,
    summary: task.summary || task.processedFields?.summary || undefined,
    fullLabel: task.fullLabel || task.processedFields?.fullLabel || undefined,
    complaintNo: task.complaintNo || task.processedFields?.complaintNo || undefined,
    aiSummary: task.aiSummary || task.processedFields?.aiSummary || undefined,
    aiJudgement: task.aiJudgement || task.processedFields?.aiJudgement || undefined,
    pushFlag: task.pushFlag || task.processedFields?.pushFlag || undefined
  })
}

const processItem = async item => {
  if (!item.itemId) return
  processingItemId.value = item.itemId
  markItemProcessing(item)
  try {
    const result = await processMideaItem(item.itemId)
    const task = result?.task || {}
    applyTaskToItem(item.itemId, task)
    if (result?.item) {
      updateItem(item.itemId, result.item)
    }
    if (task.status === 'failed') {
      message.error(task.error || '处理失败')
    } else if (task.status === 'completed') {
      message.success('处理完成')
    } else {
      message.info(`已提交处理，当前状态：${statusText(task.status)}`)
    }
    await loadItems()
  } catch (err) {
    updateItem(item.itemId, {
      status: 'failed',
      error: err.message || '处理失败'
    })
    message.error(err.message || '处理失败')
  } finally {
    processingItemId.value = null
  }
}

const canPushItem = item => (
  item?.status === 'completed' &&
  (item?.pushStatus !== 'success' || pushingItemId.value === item?.itemId)
)

const pushButtonText = item => {
  if (pushingItemId.value === item.itemId) return '推送中...'
  if (item.pushStatus === 'failed') return '重新推送'
  return '推送'
}

const pushItem = async item => {
  if (!item.itemId || !canPushItem(item)) return
  pushingItemId.value = item.itemId
  updateItem(item.itemId, {
    pushStatus: 'sending',
    pushError: ''
  })
  try {
    const result = await pushMideaItem(item.itemId)
    if (result?.item) {
      updateItem(item.itemId, result.item)
    }
    if (result?.push?.success) {
      message.success('推送成功')
    } else {
      message.error(result?.push?.error || result?.item?.pushError || '推送失败')
    }
    await loadItems()
  } catch (err) {
    updateItem(item.itemId, {
      pushStatus: 'failed',
      pushError: err.message || '推送失败'
    })
    message.error(err.message || '推送失败')
  } finally {
    pushingItemId.value = null
  }
}

const openDetail = async item => {
  selectedItem.value = item
  showDetail.value = true
  detailLoading.value = true
  try {
    const result = await getMideaItemDetail(item.itemId)
    if (selectedItem.value?.itemId === item.itemId && result?.item) {
      selectedItem.value = mergeItemPatch(selectedItem.value, result.item)
    }
  } catch (err) {
    message.error(err.message || 'Load detail failed')
  } finally {
    detailLoading.value = false
  }
}

const closeDetail = () => {
  showDetail.value = false
  selectedItem.value = null
  detailLoading.value = false
}

const handleDetailVisibleChange = visible => {
  if (!visible) closeDetail()
}

const handleStatusChange = () => {
  currentPage.value = 1
  loadItems()
}

const handlePageSizeChange = () => {
  currentPage.value = 1
  loadItems()
}

const goToPage = page => {
  const nextPage = Math.min(Math.max(page, 1), totalPages.value)
  if (nextPage === currentPage.value) return
  currentPage.value = nextPage
  loadItems()
}

const statusText = status => ({
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  received: '已接收'
})[status] || status || '-'

const pushStatusText = status => ({
  pending: '待推送',
  sending: '推送中',
  success: '已推送',
  failed: '推送失败',
  skipped: '已跳过'
})[status] || status || '-'

const progressText = item => {
  if (processingItemId.value === item.itemId) return '正在调用 midea-yq-alert 处理...'
  if (item.status === 'processing') return '处理中，请稍后刷新'
  if (item.status === 'completed') return '处理成功'
  if (item.status === 'failed') return '处理失败'
  if (item.status === 'pending') return '等待处理'
  return '未处理'
}

const processButtonText = item => {
  if (processingItemId.value === item.itemId) return '处理中...'
  if (item.status === 'processing') return '处理中'
  if (item.status === 'completed') return '重新处理'
  return '处理'
}

const formatDateTime = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize.value)))

const summaryItems = computed(() => [
  { label: '数据总条数', value: summary.value.total },
  { label: '待处理', value: summary.value.pending },
  { label: '处理中', value: summary.value.processing },
  { label: '已推送', value: summary.value.pushed },
  { label: '处理失败', value: summary.value.processFailed },
  { label: '推送失败', value: summary.value.pushFailed },
  { label: '标识推送', value: summary.value.pushFlagPush },
  { label: '情感正面', value: summary.value.emotionPositive },
  { label: '情感负面', value: summary.value.emotionNegative }
])

const selectedPreviewData = computed(() => {
  const item = selectedItem.value || {}
  const data = item.data || {}
  return {
    ...data,
    article_id: firstValue(item.article_id, item.articleId, data.id),
    push: item.push || item.pushRequest?.record || null,
    推送标识: firstValue(item.pushFlag, data.pushFlag, data.push_flag, data['推送标识']),
    完整标签: firstValue(item.fullLabel, data.fullLabel, data.full_label, data.completeLabel, data.complete_label, data['完整标签'], data['标签']),
    摘要: firstValue(item.summary, item.optimizedSummary, data.summary, data.news_digest, data.manual_digest, data['摘要']),
    投诉编号: firstValue(item.complaintNo, data.complaintNo, data.complaint_no, data['投诉编号']),
    AI总结: firstValue(item.aiSummary, data.aiSummary, data.ai_summary, data['AI总结']),
    AI研判: firstValue(item.aiJudgement, item.aiJudgment, data.aiJudgement, data.aiJudgment, data.ai_judgment, data.ai_judgement, data['AI研判'])
  }
})

const previewJson = computed(() => JSON.stringify(selectedPreviewData.value, null, 2))

onMounted(loadItems)
</script>

<style scoped>
.midea-monitor-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow: auto;
  padding: 16px;
}

.header-row,
.header-actions,
.row-actions,
.detail-header,
.pagination-row,
.pagination-actions {
  display: flex;
  align-items: center;
}

.header-row,
.detail-header,
.pagination-row {
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.header-actions,
.row-actions,
.pagination-actions {
  gap: 10px;
}

.header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
}

.title-line,
.detail-title {
  color: var(--text-color);
  font-size: 16px;
  font-weight: 700;
}

.subtitle,
.detail-subtitle,
.pagination-info {
  margin-top: 2px;
  color: var(--text-color-muted);
  font-size: 12px;
}

.status-select {
  flex: 0 0 auto;
  min-width: 132px;
  min-height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0 8px;
  color: var(--text-color);
  background: var(--panel-bg);
}

.date-input {
  min-width: 148px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 10px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
}

.summary-value {
  color: var(--text-color);
  font-size: 18px;
  font-weight: 700;
}

.summary-label {
  color: var(--text-color-muted);
  font-size: 12px;
}

.state-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-color-muted);
  background: var(--bg-color-secondary);
}

.error-box {
  justify-content: flex-start;
  min-height: 42px;
  padding: 0 12px;
  border-style: solid;
  color: var(--danger-color);
}

.list-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.table-shell {
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
}

.push-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.push-table th,
.push-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  font-size: 12px;
  vertical-align: middle;
}

.push-table th {
  color: var(--text-color-muted);
  font-weight: 600;
  background: var(--bg-color-secondary);
}

.push-table td {
  color: var(--text-color);
}

.mono,
.error-text,
.title-text,
.cell-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  color: var(--text-color);
  background: var(--bg-color-secondary);
}

.status-completed {
  color: #15803d;
  background: rgba(22, 163, 74, 0.12);
}

.status-failed {
  color: #b91c1c;
  background: rgba(220, 38, 38, 0.12);
}

.status-processing {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.14);
}

.status-pending {
  color: #92400e;
  background: rgba(245, 158, 11, 0.14);
}

.status-success {
  color: #15803d;
  background: rgba(22, 163, 74, 0.12);
}

.status-skipped {
  color: #475569;
  background: rgba(100, 116, 139, 0.12);
}

.status-sending {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.14);
}

.status-received {
  color: #475569;
  background: rgba(100, 116, 139, 0.12);
}

.text-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-color-muted);
  font-size: 12px;
  cursor: pointer;
}

.text-btn.primary,
.text-btn:hover {
  color: var(--primary-color);
}

.text-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.detail-modal {
  width: min(85vw, 1280px);
  max-height: calc(100vh - 48px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  margin: 24px auto;
  padding: 18px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-color);
  background: var(--panel-bg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 10px;
}

.detail-meta div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color-secondary);
}

.detail-meta span {
  color: var(--text-color-muted);
  font-size: 12px;
}

.detail-meta strong {
  color: var(--text-color);
  font-size: 13px;
}

.json-preview {
  min-height: 220px;
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-color);
  background: var(--bg-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.detail-loading {
  margin-bottom: 8px;
  color: var(--text-color-muted);
  font-size: 12px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 980px) {
  .summary-grid,
  .detail-meta {
    grid-template-columns: repeat(2, minmax(120px, 1fr));
  }

  .header-row,
  .pagination-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
