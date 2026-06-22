<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <n-message-provider>
      <n-dialog-provider>
        <div v-if="authReady" class="app-container" :style="cssVars">
          <MainContent />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useNaiveLocale } from '@composables/useNaiveLocale'
import { useTheme } from '@composables/useTheme'
import { requireMainPageAuth } from '@utils/auth-navigation'
import MainContent from './components/MainContent.vue'

const { naiveTheme, themeOverrides, cssVars, initTheme } = useTheme()
const { naiveLocale, naiveDateLocale, initLocale } = useNaiveLocale()
const authReady = ref(false)

onMounted(async () => {
  initLocale()
  initTheme()
  const user = await requireMainPageAuth()
  authReady.value = !!user
})
</script>

<style>
.app-container {
  min-height: 100vh;
  background-color: var(--bg-color);
  color: var(--text-color);
  transition: background-color 0.2s, color 0.2s;
}
</style>
