import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import config from '../vite.config.mjs'

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function getSpaFallbackMiddleware() {
  const plugin = config.plugins.find(item => item?.name === 'spa-fallback')
  const use = vi.fn()

  plugin.configureServer({ middlewares: { use } })

  return use.mock.calls[0][0]
}

describe('Vite entry fallback', () => {
  it('preserves root query strings for the main page entry', () => {
    const middleware = getSpaFallbackMiddleware()
    const req = { url: '/?admin=hyw' }
    const next = vi.fn()

    middleware(req, {}, next)

    expect(req.url).toBe('/pages/main/index.html?admin=hyw')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('rewrites the bare root entry to the main page', () => {
    const middleware = getSpaFallbackMiddleware()
    const req = { url: '/' }

    middleware(req, {}, vi.fn())

    expect(req.url).toBe('/pages/main/index.html')
  })

  it('exposes history session config in the web electron polyfill', () => {
    const source = readSource('src/renderer/client-api/electron-polyfill.js')

    expect(source).toContain('getMaxHistorySessions')
    expect(source).toContain('maxHistorySessions || 10')
  })

  it('defaults web API calls to the deployed page origin instead of browser localhost', () => {
    const source = readSource('src/renderer/client-api/api.js')

    expect(source).toContain('DEFAULT_API_ORIGIN')
    expect(source).toContain('window.location.origin')
  })

  it('does not bake localhost API URLs into deploy builds by default', () => {
    const source = readSource('deploy.sh')

    expect(source).toContain('run_build_command')
    expect(source).toContain('Let the web client resolve API URLs from window.location.origin')
    expect(source).not.toContain('api_base="${VITE_API_BASE:-$default_url}"')
    expect(source).not.toContain('VITE_API_BASE="$api_base" VITE_SOCKET_URL="$socket_url" npm run build')
  })

  it('proxies dev API requests to the web server default port', () => {
    expect(config.server.proxy['/api'].target).toBe('http://localhost:3456')
    expect(config.server.proxy['/socket.io'].target).toBe('http://localhost:3456')
  })

  it('starts the web runtime through PM2 in deploy.sh', () => {
    const source = readSource('deploy.sh')

    expect(source).toContain('PM2_APP_NAME')
    expect(source).toContain('pm2_start()')
    expect(source).toContain('pm2 stop "$PM2_APP_NAME"')
    expect(source).toContain('pm2 save')
    expect(source).toContain('ensure_dist')
    expect(source).toMatch(/deploy\(\) \{\s+build_frontend\s+pm2_start/)
    expect(source).toMatch(/restart\(\) \{\s+pm2_stop\s+pm2_start/)
  })

  it('uses Qinghua Kechuang as the main web page title', () => {
    const mainHtml = readSource('src/renderer/pages/main/index.html')
    const packagedMainHtmlPath = 'src/renderer/pages-dist/pages/main/index.html'
    const packagedMainHtml = existsSync(join(process.cwd(), packagedMainHtmlPath))
      ? readSource(packagedMainHtmlPath)
      : null
    const pageBootstrapSource = readSource('src/renderer/utils/page-bootstrap.js')
    const rendererZhSource = readSource('src/renderer/locales/zh-CN.js')
    const rendererEnSource = readSource('src/renderer/locales/en-US.js')
    const mainI18nSource = readSource('src/main/utils/app-i18n.js')

    expect(mainHtml).toContain('<title>舆情监控</title>')
    if (packagedMainHtml) {
      expect(packagedMainHtml).toContain('<title>舆情监控</title>')
    }
    expect(pageBootstrapSource).toContain("main: '舆情监控'")
    expect(rendererZhSource).toContain("main: '舆情监控'")
    expect(rendererEnSource).toContain("main: '舆情监控'")
    expect(mainI18nSource).toContain("main: '舆情监控'")
  })
})
