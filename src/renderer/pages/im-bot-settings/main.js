import { createApp } from 'vue'
import {
  create,
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NButton,
  NSpace,
  NInput,
  NForm,
  NFormItem,
  NSwitch,
  NRadio,
  NRadioGroup,
  NDivider,
  NSelect,
  NButtonGroup,
  NDropdown,
  NAlert,
  NCard,
  NTag,
  NTabs,
  NTabPane
} from 'naive-ui'
import App from './App.vue'
import '@/styles/common.css'
import '../../styles/settings-common.css'
import { renderBootstrapError, setPageTitle } from '@/utils/page-bootstrap'

setPageTitle('imBotSettings')

const naive = create({
  components: [
    NConfigProvider,
    NMessageProvider,
    NDialogProvider,
    NButton,
    NSpace,
    NInput,
    NForm,
    NFormItem,
    NSwitch,
    NRadio,
    NRadioGroup,
    NDivider,
    NSelect,
    NButtonGroup,
    NDropdown,
    NAlert,
    NCard,
    NTag,
    NTabs,
    NTabPane
  ]
})

try {
  const app = createApp(App)
  app.config.errorHandler = (err, vm, info) => {
    console.error('[IMBotSettings] Vue Error:', err)
    console.error('[IMBotSettings] Info:', info)
    renderBootstrapError('vue', err)
  }
  app.use(naive)
  app.mount('#app')
} catch (err) {
  console.error('[IMBotSettings] Failed to initialize:', err)
  renderBootstrapError('initialization', err)
}
