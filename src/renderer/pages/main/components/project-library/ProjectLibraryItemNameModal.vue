<template>
  <n-modal
    :show="show"
    :mask-closable="false"
    :show-icon="false"
    :auto-focus="false"
    :trap-focus="false"
    @update:show="$emit('update:show', $event)"
  >
    <section class="project-library-item-dialog">
      <header class="dialog-header">
        <h2>{{ title }}</h2>
        <button class="close-btn" type="button" title="关闭" @click="$emit('update:show', false)">
          <Icon name="close" :size="16" />
        </button>
      </header>

      <div class="form-block">
        <label class="field-label required">{{ fieldLabel }}</label>
        <div
          class="input-focus-target"
          @mousedown.capture="focusName"
          @click="focusName"
        >
          <input
            ref="nameInputRef"
            v-model="name"
            class="item-name-input native-item-name-input"
            :placeholder="placeholder"
            maxlength="80"
            type="text"
            @keydown.enter.prevent="handleSubmit"
          >
        </div>
      </div>

      <footer class="dialog-footer">
        <button class="footer-btn cancel" type="button" @click="$emit('update:show', false)">取消</button>
        <button class="footer-btn submit" type="button" :disabled="!canSubmit || submitting" @click="handleSubmit">
          {{ submitText }}
        </button>
      </footer>
    </section>
  </n-modal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { NModal } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '新建文件'
  },
  fieldLabel: {
    type: String,
    default: '文件名称'
  },
  placeholder: {
    type: String,
    default: '请输入名称'
  },
  initialName: {
    type: String,
    default: ''
  },
  submitText: {
    type: String,
    default: '确定'
  },
  submitting: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show', 'submit'])

const name = ref('')
const nameInputRef = ref(null)
const canSubmit = computed(() => name.value.trim().length > 0)

const focusName = () => {
  if (nameInputRef.value?.focus) {
    nameInputRef.value.focus()
    return
  }
  nextTick(() => nameInputRef.value?.focus?.())
}

watch(() => props.show, (show) => {
  if (!show) return
  name.value = props.initialName || ''
  nextTick(() => {
    focusName()
    nameInputRef.value?.select?.()
  })
})

watch(() => props.initialName, (initialName) => {
  if (props.show) name.value = initialName || ''
})

const handleSubmit = () => {
  if (!canSubmit.value || props.submitting) return
  emit('submit', name.value.trim())
}
</script>

<style scoped>
.project-library-item-dialog {
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

.item-name-input {
  width: 100%;
}

.native-item-name-input {
  width: 100%;
  height: 34px;
  box-sizing: border-box;
  border: 1px solid #d9e1ec;
  border-radius: 5px;
  background: #fff;
  color: #111827;
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  outline: none;
  padding: 0 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.native-item-name-input::placeholder {
  color: #9aa3b2;
}

.native-item-name-input:hover {
  border-color: #8bb9ff;
}

.native-item-name-input:focus {
  border-color: #2f7df6;
  box-shadow: 0 0 0 2px rgba(47, 125, 246, 0.12);
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
