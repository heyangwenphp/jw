import { createApp } from 'vue'
import {
  create,
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NButton,
  NSpace,
  NDropdown,
  NIcon,
  NTooltip,
  NDivider,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NColorPicker,
  NCheckbox,
  NSelect,
  NSwitch
} from 'naive-ui'
import App from './App.vue'
import { renderBootstrapError, setPageTitle } from '@/utils/page-bootstrap'
import { installElectronPolyfill } from '@/client-api/electron-polyfill.js'

// 公共样式
import '@/styles/common.css'
// KaTeX 数学公式样式
import 'katex/dist/katex.min.css'
// highlight.js 语法高亮主题（代码块使用暗色背景，独立于应用主题）
import 'highlight.js/styles/atom-one-dark.css'

// Install electron API polyfill for web version
installElectronPolyfill()

console.log('[Main] Initializing Vue app...')
setPageTitle('main')

const naive = create({
  components: [
    NConfigProvider,
    NMessageProvider,
    NDialogProvider,
    NButton,
    NSpace,
    NDropdown,
    NIcon,
    NTooltip,
    NDivider,
    NModal,
    NForm,
    NFormItem,
    NInput,
    NColorPicker,
    NCheckbox,
    NSelect,
    NSwitch
  ]
})

try {
  const app = createApp(App)
  app.config.errorHandler = (err, vm, info) => {
    console.error('[Main] Vue Error:', err)
    console.error('[Main] Info:', info)
    renderBootstrapError('vue', err)
  }
  app.use(naive)
  app.mount('#app')
  console.log('[Main] Vue app mounted successfully')
} catch (err) {
  console.error('[Main] Failed to initialize:', err)
  renderBootstrapError('initialization', err)
}
