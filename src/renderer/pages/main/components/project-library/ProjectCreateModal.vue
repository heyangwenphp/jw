<template>
  <n-modal
    :show="show"
    :mask-closable="false"
    :show-icon="false"
    :auto-focus="false"
    :trap-focus="false"
    @update:show="$emit('update:show', $event)"
  >
    <section class="project-create-dialog">
      <header class="dialog-header">
        <h2>创建项目</h2>
        <button class="close-btn" type="button" title="关闭" @click="$emit('update:show', false)">
          <Icon name="close" :size="16" />
        </button>
      </header>

      <div class="form-block">
        <label class="field-label required">项目类型</label>
        <div class="type-tabs">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            type="button"
            class="type-tab"
            :class="{ active: activeType === option.value }"
            @click="activeType = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="form-block">
        <label class="field-label required">项目名称</label>
        <n-select
          v-if="activeType === 'project'"
          v-model:value="selectedMasterId"
          class="project-select"
          :options="masterOptions"
          placeholder="请选择项目"
          :consistent-menu-width="true"
        >
          <template #empty>暂无可选项目</template>
        </n-select>
        <div
          v-else
          class="input-focus-target"
          @mousedown.capture="focusCustomName"
          @click="focusCustomName"
        >
          <input
            ref="customNameInputRef"
            v-model="customName"
            class="project-input native-project-input"
            placeholder="请输入项目名称"
            maxlength="30"
            type="text"
          >
        </div>
      </div>

      <div class="form-block">
        <label class="field-label">项目夹描述</label>
        <div
          class="description-wrap input-focus-target"
          @mousedown.capture="focusDescription"
          @click="focusDescription"
        >
          <textarea
            ref="descriptionInputRef"
            v-model="description"
            class="description-input native-description-input"
            placeholder="请输入描述"
            maxlength="100"
            rows="4"
          />
          <span class="count-text">{{ description.length }}/100</span>
        </div>
      </div>

      <footer class="dialog-footer">
        <button class="footer-btn cancel" type="button" @click="$emit('update:show', false)">取消</button>
        <button class="footer-btn submit" type="button" :disabled="!canCreate || submitting" @click="handleCreate">
          创建
        </button>
      </footer>
    </section>
  </n-modal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { NModal, NSelect } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  masterRecords: {
    type: Array,
    default: () => []
  },
  submitting: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show', 'create'])

const typeOptions = [
  { label: '项目', value: 'project' },
  { label: '自定义', value: 'custom' }
]

const activeType = ref('project')
const selectedMasterId = ref(null)
const customName = ref('')
const description = ref('')
const customNameInputRef = ref(null)
const descriptionInputRef = ref(null)

const enabledMasterRecords = computed(() => props.masterRecords.filter(record => record.enabled !== false))
const masterOptions = computed(() => enabledMasterRecords.value.map(record => ({
  label: record.name,
  value: record.id
})))
const selectedMaster = computed(() => props.masterRecords.find(record => record.id === selectedMasterId.value) || null)
const canCreate = computed(() => {
  if (activeType.value === 'project') return Boolean(selectedMasterId.value)
  return customName.value.trim().length > 0
})

const selectFirstMasterRecord = () => {
  selectedMasterId.value = masterOptions.value[0]?.value || null
}

const focusInput = (inputRef) => {
  if (inputRef.value?.focus) {
    inputRef.value.focus()
    return
  }
  nextTick(() => inputRef.value?.focus?.())
}

const focusCustomName = () => {
  if (activeType.value === 'custom') {
    focusInput(customNameInputRef)
  }
}

const focusDescription = () => {
  focusInput(descriptionInputRef)
}

watch(activeType, (type) => {
  customName.value = ''
  description.value = ''
  if (type === 'project' && masterOptions.value.length === 0) {
    activeType.value = 'custom'
    selectedMasterId.value = null
    return
  }
  if (type === 'project') {
    selectFirstMasterRecord()
  } else {
    selectedMasterId.value = null
    focusCustomName()
  }
})

watch(selectedMaster, (record) => {
  if (activeType.value === 'project') {
    description.value = String(record?.description || '').slice(0, 100)
  }
})

watch(() => props.show, (show) => {
  if (!show) return
  activeType.value = masterOptions.value.length > 0 ? 'project' : 'custom'
  selectedMasterId.value = activeType.value === 'project' ? masterOptions.value[0]?.value || null : null
  customName.value = ''
  description.value = ''
})

watch(masterOptions, () => {
  if (!props.show || activeType.value !== 'project' || selectedMasterId.value) return
  selectFirstMasterRecord()
})

const handleCreate = () => {
  if (!canCreate.value) return
  if (activeType.value === 'project') {
    emit('create', {
      masterRecordId: selectedMasterId.value,
      name: selectedMaster.value?.name || '',
      description: description.value.trim()
    })
    return
  }

  emit('create', {
    name: customName.value.trim(),
    description: description.value.trim(),
    type: 'custom'
  })
}
</script>

<style scoped>
.project-create-dialog {
  width: 392px;
  max-width: calc(100vw - 48px);
  box-sizing: border-box;
  border-radius: 8px;
  background: #fff;
  padding: 24px 18px 42px;
  box-shadow: 0 26px 70px rgba(15, 23, 42, 0.26);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.dialog-header h2 {
  margin: 0;
  color: #071a33;
  font-size: 18px;
  font-weight: 800;
  line-height: 24px;
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #111827;
}

.form-block {
  margin-top: 18px;
}

.field-label {
  display: block;
  margin-bottom: 9px;
  color: #111827;
  font-size: 14px;
  line-height: 20px;
}

.field-label.required::before {
  content: '* ';
  color: #d93026;
}

.type-tabs {
  display: grid;
  grid-template-columns: 96px 96px;
  gap: 10px;
}

.type-tab {
  height: 34px;
  border: 0;
  border-radius: 4px;
  background: #f2f3f5;
  color: #1f2937;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.type-tab.active {
  background: #dceaff;
  color: #075ff0;
}

.project-select,
.project-input {
  width: 100%;
}

.native-project-input,
.native-description-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d9e1ec;
  border-radius: 5px;
  background: #fff;
  color: #111827;
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.native-project-input {
  height: 34px;
  padding: 0 12px;
}

.native-description-input {
  display: block;
  min-height: 80px;
  padding: 8px 48px 8px 12px;
  resize: none;
}

.native-project-input::placeholder,
.native-description-input::placeholder {
  color: #9aa3b2;
}

.project-select :deep(.n-base-selection),
.project-input :deep(.n-input) {
  min-height: 34px;
  border-radius: 5px;
  background: #fff;
}

.project-select :deep(.n-base-selection__border),
.project-select :deep(.n-base-selection__state-border),
.project-input :deep(.n-input__border),
.project-input :deep(.n-input__state-border) {
  border-color: #d9e1ec;
}

.project-select:hover :deep(.n-base-selection__state-border),
.project-input:hover :deep(.n-input__state-border),
.description-input:hover :deep(.n-input__state-border),
.native-project-input:hover,
.native-description-input:hover {
  border-color: #8bb9ff;
}

.project-select :deep(.n-base-selection--active .n-base-selection__state-border),
.project-input :deep(.n-input--focus .n-input__state-border),
.description-input :deep(.n-input--focus .n-input__state-border),
.native-project-input:focus,
.native-description-input:focus {
  border-color: #2f7df6;
  box-shadow: 0 0 0 2px rgba(47, 125, 246, 0.12);
}

.description-wrap {
  position: relative;
}

.description-input :deep(.n-input) {
  border-radius: 5px;
  background: #fff;
}

.description-input :deep(.n-input__border),
.description-input :deep(.n-input__state-border) {
  border-color: #d9e1ec;
}

.description-input :deep(textarea) {
  min-height: 80px;
  padding-right: 48px;
  resize: none;
}

.count-text {
  position: absolute;
  right: 12px;
  bottom: 9px;
  color: #8a94a6;
  font-size: 13px;
  line-height: 18px;
  pointer-events: none;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 18px;
}

.footer-btn {
  min-width: 92px;
  height: 34px;
  border: 0;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.footer-btn.cancel {
  background: #f3f4f6;
  color: #1f2937;
}

.footer-btn.submit {
  background: #9cc2ff;
  color: #fff;
}

.footer-btn.submit:not(:disabled) {
  background: #2f7df6;
}

.footer-btn:disabled {
  cursor: not-allowed;
}
</style>
