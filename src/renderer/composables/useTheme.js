/**
 * Global theme composable.
 * Provides shared light/dark mode and color scheme handling.
 */
import { ref, computed, watch } from 'vue'
import { darkTheme } from 'naive-ui'
import { claudeTheme, claudeDarkTheme } from '@theme/claude-theme'

// ========== Color Scheme Definitions ==========

/**
 * Theme color schemes.
 * Each scheme has light and dark variants.
 */
const COLOR_SCHEMES = {
  // ChatGPT - neutral gray surfaces with OpenAI green accents
  chatgpt: {
    name: 'ChatGPT',
    icon: 'C',
    light: {
      primary: '#6EE7B7',
      primaryHover: '#34D399',
      primaryPressed: '#10B981',
      primaryText: '#064E3B',
      ghost: 'rgba(110, 231, 183, 0.18)',
      ghostHover: 'rgba(110, 231, 183, 0.30)',
    },
    dark: {
      primary: '#6EE7B7',
      primaryHover: '#34D399',
      primaryPressed: '#10B981',
      primaryText: '#064E3B',
      ghost: 'rgba(110, 231, 183, 0.18)',
      ghostHover: 'rgba(110, 231, 183, 0.30)',
    }
  },
  // Claude - terracotta/coral brand color
  claude: {
    name: 'Claude',
    icon: '*',
    light: {
      primary: '#DA7756',
      primaryHover: '#C96A4B',
      ghost: 'rgba(218, 119, 86, 0.08)',
      ghostHover: 'rgba(218, 119, 86, 0.15)',
    },
    dark: {
      primary: '#E08B6D',
      primaryHover: '#DA7756',
      ghost: 'rgba(224, 139, 109, 0.12)',
      ghostHover: 'rgba(224, 139, 109, 0.22)',
    }
  },
  // Ember - orange
  ember: {
    name: 'Ember',
    icon: '🔥',
    light: {
      primary: '#FF6B35',
      primaryHover: '#FF5722',
      ghost: 'rgba(255, 107, 53, 0.08)',
      ghostHover: 'rgba(255, 107, 53, 0.15)',
    },
    dark: {
      primary: '#FF6B35',
      primaryHover: '#FF5722',
      ghost: 'rgba(255, 107, 53, 0.12)',
      ghostHover: 'rgba(255, 107, 53, 0.22)',
    }
  },
  // Ocean - blue
  ocean: {
    name: 'Ocean',
    icon: '🌊',
    light: {
      primary: '#0369A1',
      primaryHover: '#075985',
      primaryPressed: '#0C4A6E',
      primaryText: '#FFFFFF',
      ghost: 'rgba(3, 105, 161, 0.08)',
      ghostHover: 'rgba(3, 105, 161, 0.15)',
    },
    dark: {
      primary: '#0284C7',
      primaryHover: '#0369A1',
      primaryPressed: '#075985',
      primaryText: '#FFFFFF',
      ghost: 'rgba(2, 132, 199, 0.12)',
      ghostHover: 'rgba(2, 132, 199, 0.22)',
    }
  },
  // Forest - green
  forest: {
    name: 'Forest',
    icon: '🌲',
    light: {
      primary: '#10B981',
      primaryHover: '#059669',
      ghost: 'rgba(16, 185, 129, 0.08)',
      ghostHover: 'rgba(16, 185, 129, 0.15)',
    },
    dark: {
      primary: '#34D399',
      primaryHover: '#10B981',
      ghost: 'rgba(52, 211, 153, 0.12)',
      ghostHover: 'rgba(52, 211, 153, 0.22)',
    }
  },
  // Violet - purple
  violet: {
    name: 'Violet',
    icon: '💜',
    light: {
      primary: '#8B5CF6',
      primaryHover: '#7C3AED',
      ghost: 'rgba(139, 92, 246, 0.08)',
      ghostHover: 'rgba(139, 92, 246, 0.15)',
    },
    dark: {
      primary: '#A78BFA',
      primaryHover: '#8B5CF6',
      ghost: 'rgba(167, 139, 250, 0.12)',
      ghostHover: 'rgba(167, 139, 250, 0.22)',
    }
  },
  // Rose - rose
  rose: {
    name: 'Rose',
    icon: '🌹',
    light: {
      primary: '#E11D48',
      primaryHover: '#BE123C',
      ghost: 'rgba(225, 29, 72, 0.08)',
      ghostHover: 'rgba(225, 29, 72, 0.15)',
    },
    dark: {
      primary: '#FB7185',
      primaryHover: '#E11D48',
      ghost: 'rgba(251, 113, 133, 0.12)',
      ghostHover: 'rgba(251, 113, 133, 0.22)',
    }
  }
}

const LEGACY_COLOR_SCHEME_MAP = {
  graphite: 'rose'
}

const normalizeColorSchemeKey = (scheme) => {
  const normalizedScheme = LEGACY_COLOR_SCHEME_MAP[scheme] || scheme
  return COLOR_SCHEMES[normalizedScheme] ? normalizedScheme : null
}

// Export scheme list for UI use.
export const colorSchemeList = Object.entries(COLOR_SCHEMES).map(([key, value]) => ({
  key,
  name: value.name,
  icon: value.icon,
  primaryLight: value.light.primary,
  primaryDark: value.dark.primary
}))

// ========== Shared State ==========

// Read the initial theme injected by preload to avoid first-paint flicker.
const getBootstrapThemeState = () => {
  if (typeof window === 'undefined') return null
  return window.electronAPI?.bootstrap || null
}

const getInitialTheme = () => {
  const bootstrapState = getBootstrapThemeState()
  if (bootstrapState) {
    return bootstrapState.theme === 'dark'
  }
  if (typeof document !== 'undefined') {
    return document.documentElement.getAttribute('data-theme') === 'dark'
  }
  return false
}

const getInitialColorScheme = () => {
  const bootstrapState = getBootstrapThemeState()
  if (bootstrapState) {
    return normalizeColorSchemeKey(bootstrapState.colorScheme) || 'ocean'
  }
  if (typeof document === 'undefined') return 'ocean'
  return normalizeColorSchemeKey(document.documentElement.getAttribute('data-color-scheme')) || 'ocean'
}

// Shared theme state across components.
// Preserve values across HMR so colorScheme does not reset mid-edit.
const isDark = ref(import.meta.hot?.data?.isDark ?? getInitialTheme())
const colorScheme = ref(normalizeColorSchemeKey(import.meta.hot?.data?.colorScheme) ?? getInitialColorScheme())
const isInitialized = ref(import.meta.hot?.data?.isInitialized ?? false)

// Global listener cleanup to avoid duplicate HMR registrations.
let _settingsCleanup = null

// Sync DOM theme attributes.
const syncDOMTheme = (dark) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-color-scheme', colorScheme.value)
    document.documentElement.style.backgroundColor = dark ? '#212121' : '#F7F7F8'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.body.style.backgroundColor = dark ? '#212121' : '#F7F7F8'
  }
}

const toRgbTriplet = (hex) => {
  const normalized = hex?.replace('#', '')
  if (!normalized || normalized.length !== 6) return '0, 0, 0'

  return [0, 2, 4]
    .map(offset => parseInt(normalized.slice(offset, offset + 2), 16))
    .join(', ')
}

/**
 * Build CSS variable object.
 * Shared by cssVars computed and syncCSSVarsToRoot.
 */
const buildCSSVars = (dark, colors) => {
  const fontMono = '"JetBrains Mono", "Cascadia Code", "SF Mono", "Consolas", "Monaco", "Ubuntu Mono", monospace'
  const fontLogo = '"Crimson Pro", "Georgia", "Times New Roman", serif'
  const primaryRgb = toRgbTriplet(colors.primary)

  if (dark) {
    return {
      '--font-mono': fontMono,
      '--font-logo': fontLogo,
      '--bg-color': '#212121',
      '--bg-color-secondary': '#2F2F2F',
      '--bg-color-tertiary': '#3A3A3A',
      '--panel-bg': '#2F2F2F',
      '--panel-bg-subtle': '#3A3A3A',
      '--text-color': '#ECECF1',
      '--text-color-secondary': '#C5C5D2',
      '--text-color-muted': '#8E8EA0',
      '--border-color': '#4A4A4A',
      '--border-color-light': '#565869',
      '--panel-border': '#3A3A3A',
      '--primary-color': colors.primary,
      '--primary-color-rgb': primaryRgb,
      '--primary-color-hover': colors.primaryHover,
      '--primary-ghost': colors.ghost,
      '--primary-ghost-hover': colors.ghostHover,
      '--primary-shadow': `0 10px 24px rgba(${primaryRgb}, 0.22)`,
      '--selected-bg': 'rgba(255, 255, 255, 0.06)',
      '--selected-border': `rgba(${primaryRgb}, 0.3)`,
      '--danger-color': '#F87171',
      '--success-color': '#34D399',
      '--warning-color': '#FBBF24',
      '--info-color': '#60A5FA',
      '--panel-radius': '12px',
      '--panel-shadow-soft': '0 10px 28px rgba(0, 0, 0, 0.22)',
      '--shadow-color': 'rgba(0, 0, 0, 0.3)',
      '--scrollbar-thumb': '#565869',
      '--warning-bg': '#3A3122',
      '--warning-text': '#FBBF24',
      '--hover-bg': '#3A3A3A'
    }
  }
  return {
    '--font-mono': fontMono,
    '--font-logo': fontLogo,
    '--bg-color': '#F7F7F8',
    '--bg-color-secondary': '#FFFFFF',
    '--bg-color-tertiary': '#F3F4F6',
    '--panel-bg': '#FFFFFF',
    '--panel-bg-subtle': '#F3F4F6',
    '--text-color': '#202123',
    '--text-color-secondary': '#5F6368',
    '--text-color-muted': '#8E8EA0',
    '--border-color': '#E5E5E5',
    '--border-color-light': '#D9D9E3',
    '--panel-border': '#E5E5E5',
    '--primary-color': colors.primary,
    '--primary-color-rgb': primaryRgb,
    '--primary-color-hover': colors.primaryHover,
    '--primary-ghost': colors.ghost,
    '--primary-ghost-hover': colors.ghostHover,
    '--primary-shadow': `0 10px 22px rgba(${primaryRgb}, 0.16)`,
    '--selected-bg': colors.ghost,
    '--selected-border': `rgba(${primaryRgb}, 0.22)`,
    '--danger-color': '#DC2626',
    '--success-color': '#2E9E5E',
    '--warning-color': '#D97706',
    '--info-color': '#2563EB',
    '--panel-radius': '12px',
    '--panel-shadow-soft': '0 8px 24px rgba(27, 31, 35, 0.06)',
    '--shadow-color': 'rgba(0, 0, 0, 0.08)',
    '--scrollbar-thumb': '#C5C5D2',
    '--warning-bg': '#FFF7E6',
    '--warning-text': '#9A5B13',
    '--hover-bg': '#ECECF1'
  }
}

/**
 * Sync CSS variables to :root (document.documentElement).
 * Teleported components such as n-modal need these variables at document scope.
 */
const syncCSSVarsToRoot = () => {
  if (typeof document === 'undefined') return
  const schemeKey = normalizeColorSchemeKey(colorScheme.value) || 'ocean'
  const scheme = COLOR_SCHEMES[schemeKey]
  const colors = isDark.value ? scheme.dark : scheme.light
  const vars = buildCSSVars(isDark.value, colors)
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

// Watch theme changes and sync DOM.
watch(isDark, (dark) => {
  syncDOMTheme(dark)
  syncCSSVarsToRoot()
}, { immediate: false })

// Watch color scheme changes and sync CSS variables.
watch(colorScheme, () => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-color-scheme', colorScheme.value)
  }
  syncCSSVarsToRoot()
})

// Initial sync.
syncCSSVarsToRoot()

/**
 * Theme management hook.
 */
export function useTheme() {
  /**
   * Initialize theme from persisted config.
   */
  const initTheme = async () => {
    if (isInitialized.value) return

    try {
      if (window.electronAPI) {
        const config = await window.electronAPI.getConfig()
        isDark.value = config?.settings?.theme === 'dark'
        // Load color scheme.
        const savedScheme = normalizeColorSchemeKey(config?.settings?.colorScheme)
        if (savedScheme) {
          colorScheme.value = savedScheme
        }
      }
    } catch (err) {
      console.error('[useTheme] Failed to load theme config:', err)
    }

    isInitialized.value = true
  }

  /**
   * Toggle light/dark mode.
   */
  const toggleTheme = async () => {
    isDark.value = !isDark.value
    await saveTheme()
  }

  /**
   * Set light/dark mode.
   */
  const setTheme = async (dark) => {
    isDark.value = dark
    await saveTheme()
  }

  /**
   * Set color scheme.
   */
  const setColorScheme = async (scheme) => {
    const normalizedScheme = normalizeColorSchemeKey(scheme)
    if (normalizedScheme) {
      colorScheme.value = normalizedScheme
      await saveTheme()
    }
  }

  /**
   * Save theme to config and broadcast to other windows.
   */
  const saveTheme = async () => {
    try {
      if (window.electronAPI) {
        const theme = isDark.value ? 'dark' : 'light'
        await window.electronAPI.updateSettings({
          theme,
          colorScheme: colorScheme.value
        })
        // Broadcast to all windows.
        window.electronAPI.broadcastSettings({
          theme,
          colorScheme: colorScheme.value
        })
      }
    } catch (err) {
      console.error('[useTheme] Failed to save theme:', err)
    }
  }

  /**
   * Listen for theme changes from other windows.
   */
  const listenForChanges = () => {
    if (_settingsCleanup) return // 已注册，避免 HMR 重复注册
    if (window.electronAPI?.onSettingsChanged) {
      _settingsCleanup = window.electronAPI.onSettingsChanged((settings) => {
        if (settings.theme !== undefined) {
          const newDark = settings.theme === 'dark'
          if (isDark.value !== newDark) {
            isDark.value = newDark
          }
        }
        const nextScheme = normalizeColorSchemeKey(settings.colorScheme)
        if (nextScheme) {
          if (colorScheme.value !== nextScheme) {
            colorScheme.value = nextScheme
          }
        }
      })
    }
  }

  // Start listening automatically.
  listenForChanges()

  /**
   * Current color scheme values.
   */
  const currentColors = computed(() => {
    const schemeKey = normalizeColorSchemeKey(colorScheme.value) || 'ocean'
    const scheme = COLOR_SCHEMES[schemeKey]
    return isDark.value ? scheme.dark : scheme.light
  })

  /**
   * Naive UI theme object.
   */
  const naiveTheme = computed(() => {
    return isDark.value ? darkTheme : null
  })

  /**
   * Naive UI theme overrides with dynamic primary color.
   */
  const themeOverrides = computed(() => {
    const baseTheme = isDark.value ? claudeDarkTheme : claudeTheme
    const colors = currentColors.value
    const primaryTextColor = colors.primaryText ?? '#ffffff'

    // Deep merge every component token that uses the primary color.
    return {
      ...baseTheme,
      common: {
        ...baseTheme.common,
        primaryColor: colors.primary,
        primaryColorHover: colors.primaryHover,
        primaryColorPressed: colors.primaryPressed ?? colors.primaryHover,
        primaryColorSuppl: colors.primary
      },
      Button: {
        ...baseTheme.Button,
        colorPrimary: colors.primary,
        colorHoverPrimary: colors.primaryHover,
        colorPressedPrimary: colors.primaryPressed ?? colors.primaryHover,
        textColorPrimary: primaryTextColor,
        textColorHoverPrimary: primaryTextColor,
        textColorPressedPrimary: primaryTextColor,
        textColorFocusPrimary: primaryTextColor,
        // Warning buttons follow the current primary color.
        colorWarning: colors.primary,
        colorHoverWarning: colors.primaryHover,
        colorPressedWarning: colors.primaryPressed ?? colors.primaryHover,
        textColorWarning: primaryTextColor,
        textColorHoverWarning: primaryTextColor,
        textColorPressedWarning: primaryTextColor,
        textColorFocusWarning: primaryTextColor,
        borderWarning: `1px solid ${colors.primary}`,
        borderHoverWarning: `1px solid ${colors.primaryHover}`,
        borderPressedWarning: `1px solid ${colors.primaryPressed ?? colors.primaryHover}`,
        borderFocusWarning: `1px solid ${colors.primaryHover}`
      },
      Input: {
        ...baseTheme.Input,
        borderHover: `1px solid ${colors.primary}`,
        borderFocus: `1px solid ${colors.primary}`,
        boxShadowFocus: `0 0 0 3px ${colors.ghost}`
      },
      Switch: {
        ...baseTheme.Switch,
        railColorActive: colors.primary
      },
      Spin: {
        ...baseTheme.Spin,
        color: colors.primary
      },
      Dialog: {
        ...baseTheme.Dialog,
        iconColorWarning: colors.primary
      },
      Message: {
        ...baseTheme.Message,
        iconColorSuccess: colors.primary,
        iconColorWarning: colors.primary,
        iconColorError: colors.primary,
        iconColorInfo: colors.primary,
        iconColorLoading: colors.primary
      },
      Notification: {
        ...baseTheme.Notification,
        iconColorSuccess: colors.primary,
        iconColorWarning: colors.primary,
        iconColorError: colors.primary,
        iconColorInfo: colors.primary
      }
    }
  })

  /**
   * Theme CSS variables for custom styles.
   */
  const cssVars = computed(() => {
    return buildCSSVars(isDark.value, currentColors.value)
  })

  return {
    isDark,
    colorScheme,
    colorSchemeList,
    currentColors,
    naiveTheme,
    themeOverrides,
    cssVars,
    initTheme,
    toggleTheme,
    setTheme,
    setColorScheme
  }
}

// HMR: preserve current state and clean listeners so colorScheme does not reset.
// test-hmr-2
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.isDark = isDark.value
    data.colorScheme = colorScheme.value
    data.isInitialized = isInitialized.value
    _settingsCleanup?.()
    _settingsCleanup = null
  })
}

