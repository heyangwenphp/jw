import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const rendererRoot = resolve(__dirname, 'src/renderer')
const page = name => resolve(rendererRoot, `pages/${name}/index.html`)
const vitePort = Number(process.env.JEDI_VITE_PORT || process.env.VITE_PORT || 6173)
const webPort = Number(process.env.JEDI_WEB_PORT || process.env.PORT || 3456)
const webTarget = `http://localhost:${webPort}`

function spaFallback() {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url?.startsWith('/?')) {
          const query = req.url.slice(1)
          req.url = `/pages/main/index.html${query}`
        }
        next()
      })
    }
  }
}

export default defineConfig({
  root: rendererRoot,
  publicDir: resolve(rendererRoot, 'public'),
  plugins: [
    vue(),
    spaFallback()
  ],
  resolve: {
    alias: {
      '@': rendererRoot,
      '@components': resolve(rendererRoot, 'components'),
      '@composables': resolve(rendererRoot, 'composables'),
      '@utils': resolve(rendererRoot, 'utils'),
      '@styles': resolve(rendererRoot, 'styles'),
      '@theme': resolve(rendererRoot, 'theme'),
      '@locales': resolve(rendererRoot, 'locales'),
      '@api': resolve(rendererRoot, 'client-api'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': {
        target: webTarget,
        changeOrigin: true
      },
      '/socket.io': {
        target: webTarget,
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: page('main'),
        login: page('login'),
        profileManager: page('profile-manager'),
        providerManager: page('provider-manager'),
        modelSettings: page('model-settings'),
        globalSettings: page('global-settings'),
        appearanceSettings: page('appearance-settings'),
        settingsWorkbench: page('settings-workbench'),
        imBotSettings: page('im-bot-settings'),
        dingtalkSettings: page('dingtalk-settings'),
        sessionManager: page('session-manager'),
        updateManager: page('update-manager')
      }
    }
  },
  test: {
    environment: 'node',
    setupFiles: [resolve(__dirname, 'tests/setup.js')],
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],
    alias: {
      '@': rendererRoot,
      '@components': resolve(rendererRoot, 'components'),
      '@composables': resolve(rendererRoot, 'composables'),
      '@utils': resolve(rendererRoot, 'utils'),
      '@styles': resolve(rendererRoot, 'styles'),
      '@theme': resolve(rendererRoot, 'theme'),
      '@locales': resolve(rendererRoot, 'locales'),
      '@api': resolve(rendererRoot, 'client-api'),
      '@main': resolve(__dirname, 'src/main')
    },
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.js'],
      exclude: ['src/renderer/**']
    }
  }
})
