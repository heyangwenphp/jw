<template>
  <div class="skill-group">
    <div class="group-header clickable">
      <span class="group-toggle" @click="$emit('toggle')"><Icon :name="expanded ? 'chevronDown' : 'chevronRight'" :size="10" /></span>
      <span class="group-icon" @click="$emit('toggle')"><Icon :name="icon" :size="14" /></span>
      <span class="group-name" @click="$emit('toggle')">{{ title }}</span>
      <span class="group-count" @click="$emit('toggle')">({{ skills.length }})</span>
      <button v-if="editable" class="group-add-btn" :title="createTitle" @click.stop="$emit('create')"><Icon name="add" :size="12" /></button>
    </div>
    <div v-if="expanded" class="group-items">
      <template v-if="skills.length > 0">
        <div
          v-for="skill in skills"
          :key="`${groupKey}-${skill.id}`"
          class="skill-item"
          :class="{ disabled: skill.disabled }"
          @click="$emit('click-skill', skill)"
        >
          <div class="skill-row">
            <span class="skill-name">
              {{ skill.id }} <span class="skill-invoke">(/{{ skill.name || skill.id }})</span>
              <span v-if="skill.marketSource" class="market-badge">{{ t('rightPanel.skills.market.marketBadge') }}</span>
            </span>
            <span class="skill-actions">
              <button
                v-if="copy && skill.canCopy !== false"
                class="icon-btn inline"
                :title="copyTitle"
                @click.stop="copy(skill)"
              ><Icon name="copy" :size="14" /></button>
              <button
                v-if="editable && canManageSkill(skill)"
                class="icon-btn inline"
                :title="t('rightPanel.skills.edit')"
                @click.stop="$emit('edit', skill)"
              ><Icon name="edit" :size="14" /></button>
              <button
                v-if="editable && canManageSkill(skill)"
                class="icon-btn inline"
                :title="t('rightPanel.skills.delete')"
                @click.stop="$emit('delete', skill)"
              ><Icon name="delete" :size="14" /></button>
            </span>
            <span
              v-if="toggleable && canManageSkill(skill)"
              class="skill-toggle-hitbox"
              :title="skill.disabled ? t('rightPanel.skills.enable') : t('rightPanel.skills.disable')"
              @click.stop
            >
              <n-switch
                class="skill-toggle"
                size="small"
                :value="!skill.disabled"
                @update:value="(val) => $emit('toggle-disabled', skill, !val)"
              />
            </span>
            <n-switch
              v-if="visibilityToggleable && skill.canToggleVisibility !== false"
              class="skill-visibility-toggle"
              size="small"
              :title="skill.visibility === 'public' ? t('rightPanel.skills.makePrivate') : t('rightPanel.skills.makePublic')"
              :rail-style="() => ({})"
              :value="skill.visibility === 'public'"
              @update:value="(val) => $emit('toggle-visibility', skill, val ? 'public' : 'private')"
              @click.stop
            >
              <template #checked><Icon name="globe" :size="10" /></template>
              <template #unchecked><Icon name="lock" :size="10" /></template>
            </n-switch>
          </div>
          <span class="skill-desc">{{ skill.description }}</span>
        </div>
      </template>
      <div v-else class="empty-hint-inline">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NSwitch } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import Icon from '@components/icons/Icon.vue'

const { t } = useLocale()

const props = defineProps({
  groupKey: { type: String, required: true },
  skills: { type: Array, default: () => [] },
  title: { type: String, required: true },
  icon: { type: String, default: 'folder' },
  editable: { type: Boolean, default: false },
  toggleable: { type: Boolean, default: false },
  visibilityToggleable: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  emptyText: { type: String, default: '' },
  copy: { type: Function, default: null },
  copyTitle: { type: String, default: '' }
})

defineEmits(['toggle', 'create', 'click-skill', 'edit', 'delete', 'openFile', 'toggle-disabled', 'toggle-visibility'])

const canManageSkill = (skill) => skill?.canManage !== false

const createTitle = computed(() => {
  return props.groupKey === 'project'
    ? t('rightPanel.skills.createProject')
    : t('rightPanel.skills.createUser')
})
</script>

<style scoped>
.skill-group {
  display: flex;
  flex-direction: column;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-muted);
}

.group-header.clickable {
  cursor: pointer;
  transition: background 0.15s ease;
}

.group-header.clickable:hover {
  background: var(--hover-bg);
}

.group-toggle {
  font-size: 10px;
  width: 12px;
}

.group-icon {
  font-size: 14px;
}

.group-name {
  flex: 1;
}

.group-count {
  font-weight: 400;
  opacity: 0.7;
}

.group-add-btn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid var(--border-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-color-muted);
  transition: all 0.15s ease;
  margin-left: 4px;
}

.group-add-btn:hover {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.group-items {
  padding: 4px 0;
}

.skill-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  margin: 2px 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.skill-item.disabled .skill-name,
.skill-item.disabled .skill-desc {
  opacity: 0.5;
}

.skill-item:hover {
  background: var(--hover-bg);
}

.skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  flex: 1;
}

.skill-name .skill-invoke {
  color: var(--primary-color);
  font-weight: 400;
}

.skill-name .market-badge {
  font-size: 10px;
  padding: 0 4px;
  margin-left: 4px;
  border-radius: 3px;
  background: var(--primary-color);
  color: #fff;
  font-weight: 500;
  vertical-align: middle;
}

.skill-actions {
  display: none;
  gap: 4px;
}

.skill-toggle-hitbox {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}

.skill-toggle {
  flex-shrink: 0;
}

.skill-visibility-toggle {
  flex-shrink: 0;
}

.skill-item:hover .skill-actions {
  display: flex;
}

.skill-item:hover .icon-btn.inline {
  opacity: 0.7;
}

.skill-desc {
  font-size: 11px;
  color: var(--text-color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint-inline {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-muted);
  opacity: 0.7;
}
</style>
