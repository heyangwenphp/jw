<template>
  <div class="im-tab">
    <div class="header">
      <h1>{{ t('im.title') }}</h1>
    </div>

    <div class="content-layout">
      <!-- Left Panel: Bot List -->
      <div class="left-panel">
        <div class="panel-header">
          <span class="panel-title">{{ t('im.bots') }}</span>
        </div>
        <div class="bot-list">
          <div
            v-for="bot in bots"
            :key="bot.id"
            class="bot-item"
            :class="{ active: selectedBotId === bot.id }"
            @click="selectBot(bot.id)"
          >
            <div class="bot-icon">
              <Icon :name="bot.icon" :size="20" />
            </div>
            <span class="bot-name">{{ bot.name }}</span>
            <div class="bot-status">
              <div
                v-if="bot.connected"
                class="status-dot connected"
                :title="t('im.connected')"
              ></div>
              <div
                v-else
                class="status-dot disconnected"
                :title="t('im.disconnected')"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Bot Settings -->
      <div class="right-panel" v-if="selectedBot">
        <component :is="selectedBot.component" />
      </div>

      <div class="right-panel empty-panel" v-else>
        <div class="empty-content">
          <Icon name="settings" :size="48" />
          <p>{{ t('im.selectBotHint') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, markRaw, onMounted } from 'vue'
import { useLocale } from '@composables/useLocale'
import Icon from '@components/icons/Icon.vue'
import DingTalkSettingsPanel from './DingTalkSettingsPanel.vue'
import WeixinSettingsPanel from './WeixinSettingsPanel.vue'
import FeishuSettingsPanel from './FeishuSettingsPanel.vue'

const { t, initLocale } = useLocale()

const selectedBotId = ref(null)

const bots = ref([
  { id: 'dingtalk', name: 'DingTalk', icon: 'robot', component: markRaw(DingTalkSettingsPanel) },
  { id: 'weixin', name: 'WeChat', icon: 'weixin', component: markRaw(WeixinSettingsPanel) },
  { id: 'feishu', name: 'Feishu', icon: 'feishu', component: markRaw(FeishuSettingsPanel) }
])

const selectedBot = computed(() => {
  return bots.value.find(b => b.id === selectedBotId.value)
})

const selectBot = (botId) => {
  selectedBotId.value = botId
}

onMounted(async () => {
  await initLocale()
  if (bots.value.length > 0) {
    selectedBotId.value = bots.value[0].id
  }
})
</script>

<style scoped>
.im-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

.content-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.left-panel {
  width: 280px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color-secondary);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-secondary);
}

.bot-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.bot-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background-color 0.2s;
}

.bot-item:hover {
  background-color: var(--bg-color-tertiary);
}

.bot-item.active {
  background-color: var(--primary-ghost);
}

.bot-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color-tertiary);
  border-radius: 8px;
}

.bot-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.bot-status {
  display: flex;
  align-items: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.connected {
  background-color: #10b981;
}

.status-dot.disconnected {
  background-color: #d1d5db;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-content {
  text-align: center;
  color: var(--text-color-secondary);
}

.empty-content p {
  margin-top: 12px;
  font-size: 14px;
}
</style>
