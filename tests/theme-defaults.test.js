import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('Ocean default theme', () => {
  const useThemeSource = readSource('src/renderer/composables/useTheme.js')

  it('defines Ocean as the default blue color scheme', () => {
    expect(useThemeSource).toContain('ocean:')
    expect(useThemeSource).toContain("name: 'Ocean'")
    expect(useThemeSource).toContain("primary: '#0369A1'")
    expect(useThemeSource).toContain("primaryHover: '#075985'")
    expect(useThemeSource).toContain("primaryPressed: '#0C4A6E'")
    expect(useThemeSource).toContain("primaryText: '#FFFFFF'")
    expect(useThemeSource).toContain("'--bg-color': '#F7F7F8'")
    expect(useThemeSource).toContain("'--panel-bg': '#FFFFFF'")
  })

  it('uses Ocean as the fallback color scheme', () => {
    expect(useThemeSource).toContain("|| 'ocean'")
    expect(useThemeSource).not.toContain("|| 'chatgpt'")
    expect(useThemeSource).not.toContain("|| 'ember'")
    expect(useThemeSource).not.toContain("|| 'claude'")
  })
})

describe('default configuration and bootstrap palette', () => {
  it('starts new configs with the Ocean scheme', () => {
    const configSource = readSource('src/main/config-manager.js')
    expect(configSource).toContain("colorScheme: 'ocean'")
  })

  it('uses the Ocean blue in Naive UI components', () => {
    const themeSource = readSource('src/renderer/theme/claude-theme.js')

    expect(themeSource).toContain("primaryColor: '#0369A1'")
    expect(themeSource).toContain("primaryColorHover: '#075985'")
    expect(themeSource).toContain("primaryColorPressed: '#0C4A6E'")
    expect(themeSource).toContain("textColorPrimary: '#FFFFFF'")
    expect(themeSource).toContain("textColorHoverPrimary: '#FFFFFF'")
    expect(themeSource).toContain("textColorPressedPrimary: '#FFFFFF'")
  })

  it('uses Ocean for web bootstrap fallback', () => {
    const mainHtml = readSource('src/renderer/pages/main/index.html')
    const polyfill = readSource('src/renderer/client-api/electron-polyfill.js')

    expect(mainHtml).toContain(": 'ocean'")
    expect(polyfill).toContain("colorScheme: 'ocean'")
  })

  it('uses the ChatGPT neutral shell background before windows render', () => {
    const mainProcess = readSource('src/main/index.js')
    const ipcHandlers = readSource('src/main/ipc-handlers.js')

    expect(mainProcess).toContain("return isDark ? '#212121' : '#F7F7F8'")
    expect(mainProcess).toContain("return '#F7F7F8'")
    expect(ipcHandlers).toContain("return isDark ? '#212121' : '#F7F7F8'")
  })

  it('resets appearance settings to the Ocean scheme', () => {
    const globalSettings = readSource('src/renderer/pages/global-settings/components/GlobalSettingsContent.vue')
    const appearanceSettings = readSource('src/renderer/pages/appearance-settings/components/AppearanceSettingsContent.vue')

    expect(globalSettings).toContain("colorScheme: 'ocean'")
    expect(globalSettings).toContain("await setColorScheme('ocean')")
    expect(appearanceSettings).toContain("colorScheme: 'ocean'")
  })
})
