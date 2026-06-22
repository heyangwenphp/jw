import { createApp } from 'vue'
import {
  create,
  NConfigProvider,
  NMessageProvider,
  NButton,
  NInput
} from 'naive-ui'
import App from './App.vue'
import { renderBootstrapError } from '@/utils/page-bootstrap'
import { installElectronPolyfill } from '@/client-api/electron-polyfill.js'

import '@/styles/common.css'

installElectronPolyfill()

const naive = create({
  components: [
    NConfigProvider,
    NMessageProvider,
    NButton,
    NInput
  ]
})

try {
  const app = createApp(App)
  app.config.errorHandler = (err, vm, info) => {
    console.error('[Login] Vue Error:', err)
    console.error('[Login] Info:', info)
    renderBootstrapError('vue', err)
  }
  app.use(naive)
  app.mount('#app')
} catch (err) {
  console.error('[Login] Failed to initialize:', err)
  renderBootstrapError('initialization', err)
}
