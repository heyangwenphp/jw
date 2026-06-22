<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <n-message-provider>
      <main class="login-page" :style="cssVars">
        <section class="login-panel">
          <div class="brand-block">
            <div class="brand-mark">舆</div>
            <div>
              <h1>舆情监控</h1>
              <p>登录 / 注册</p>
            </div>
          </div>

          <form class="login-form" @submit.prevent="handleSubmit">
            <label class="field">
              <span>手机号</span>
              <n-input
                v-model:value="phone"
                placeholder="请输入手机号"
                autocomplete="tel"
                :disabled="submitting"
              />
            </label>

            <label class="field">
              <span>密码</span>
              <n-input
                v-model:value="password"
                placeholder="请输入密码"
                type="password"
                show-password-on="click"
                autocomplete="current-password"
                :disabled="submitting"
              />
            </label>

            <div v-if="error" class="login-error">{{ error }}</div>

            <n-button
              type="primary"
              size="large"
              block
              attr-type="submit"
              :loading="submitting"
              :disabled="submitting"
            >
              登录 / 注册
            </n-button>
          </form>
        </section>
      </main>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useNaiveLocale } from '@composables/useNaiveLocale'
import { useTheme } from '@composables/useTheme'
import { redirectToMainPage } from '@utils/auth-navigation'

const { naiveTheme, themeOverrides, cssVars, initTheme } = useTheme()
const { naiveLocale, naiveDateLocale, initLocale } = useNaiveLocale()

const phone = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

onMounted(async () => {
  initLocale()
  initTheme()

  const current = await window.electronAPI?.authGetCurrentUser?.().catch(() => null)
  if (current?.user) {
    redirectToMainPage()
  }
})

const handleSubmit = async () => {
  if (submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    if (!window.electronAPI?.authLogin) {
      error.value = '登录接口不可用'
      return
    }
    const result = await window.electronAPI.authLogin({
      phone: phone.value,
      password: password.value
    })
    if (result?.error) {
      error.value = result.error
      return
    }
    redirectToMainPage()
  } catch (err) {
    error.value = err?.message || '登录失败'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    linear-gradient(135deg, rgba(24, 160, 88, 0.08), transparent 42%),
    var(--bg-color);
  color: var(--text-color);
}

.login-panel {
  width: min(420px, 100%);
  padding: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.14);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}

.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--primary-color);
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}

h1 {
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

p {
  margin-top: 4px;
  color: var(--text-color-muted);
  font-size: 13px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.login-error {
  color: var(--error-color, #d03050);
  font-size: 13px;
  line-height: 1.5;
}
</style>
