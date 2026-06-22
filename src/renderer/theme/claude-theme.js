/**
 * Naive UI ChatGPT-style Theme Configuration
 * Neutral surfaces with a soft green accent palette.
 */
export const claudeTheme = {
  common: {
    // Primary color
    primaryColor: '#0369A1',
    primaryColorHover: '#075985',
    primaryColorPressed: '#0C4A6E',
    primaryColorSuppl: '#0369A1',

    // Semantic colors
    successColor: '#075985',
    warningColor: '#D97706',
    errorColor: '#DC2626',
    infoColor: '#2563EB',

    // Radius
    borderRadius: '8px',
    borderRadiusSmall: '6px',

    // Fonts
    fontFamily: "'Plus Jakarta Sans', 'PingFang SC', 'Microsoft YaHei', 'HarmonyOS Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: '14px',
    fontSizeMedium: '14px',
    fontSizeSmall: '13px',

    // Text colors
    textColor1: '#202123',
    textColor2: '#5F6368',
    textColor3: '#8E8EA0',

    // Background colors
    bodyColor: '#F7F7F8',
    cardColor: '#FFFFFF',
    modalColor: '#FFFFFF',
    popoverColor: '#FFFFFF',

    // Border colors
    dividerColor: '#E5E5E5',
    borderColor: '#E5E5E5',

    // Shadows
    boxShadow1: '0 2px 8px rgba(0, 0, 0, 0.08)',
    boxShadow2: '0 4px 16px rgba(0, 0, 0, 0.12)',
    boxShadow3: '0 8px 24px rgba(0, 0, 0, 0.16)'
  },

  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px',
    paddingMedium: '8px 16px',
    paddingSmall: '6px 12px',
    fontSizeMedium: '14px',
    fontSizeSmall: '13px',
    heightMedium: '36px',
    heightSmall: '30px',
    colorPrimary: '#0369A1',
    colorHoverPrimary: '#075985',
    colorPressedPrimary: '#0C4A6E',
    textColorPrimary: '#FFFFFF',
    textColorHoverPrimary: '#FFFFFF',
    textColorPressedPrimary: '#FFFFFF',
    textColorFocusPrimary: '#FFFFFF'
  },

  Input: {
    borderRadius: '8px',
    heightMedium: '40px',
    paddingMedium: '0 12px',
    fontSizeMedium: '14px',
    borderHover: '1px solid #0369A1',
    borderFocus: '1px solid #0369A1',
    boxShadowFocus: '0 0 0 3px rgba(110, 231, 183, 0.22)'
  },

  Card: {
    borderRadius: '12px',
    paddingMedium: '20px',
    paddingLarge: '24px',
    titleFontSizeMedium: '16px',
    titleFontWeight: '600',
    color: '#FFFFFF',
    colorEmbedded: '#F3F4F6'
  },

  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '8px',
        heightMedium: '40px'
      }
    }
  },

  Switch: {
    railHeightMedium: '20px',
    railWidthMedium: '40px',
    buttonHeightMedium: '16px',
    buttonWidthMedium: '16px',
    railColorActive: '#0369A1'
  },

  Tag: {
    borderRadius: '12px',
    padding: '0 10px',
    fontSizeSmall: '12px',
    heightSmall: '22px'
  },

  Modal: {
    borderRadius: '12px',
    padding: '24px',
    color: '#FFFFFF'
  },

  Message: {
    borderRadius: '8px',
    padding: '12px 16px'
  },

  Notification: {
    borderRadius: '12px',
    padding: '16px 20px'
  },

  Form: {
    labelFontWeight: '500',
    labelFontSizeTopMedium: '14px',
    feedbackFontSizeMedium: '13px'
  },

  DataTable: {
    borderRadius: '8px',
    thColor: '#F3F4F6',
    tdColor: '#FFFFFF'
  },

  Dropdown: {
    borderRadius: '8px',
    optionHeightMedium: '36px',
    padding: '4px'
  },

  Popover: {
    borderRadius: '8px',
    padding: '12px'
  },

  Tooltip: {
    borderRadius: '6px',
    padding: '8px 12px'
  },

  Empty: {
    iconSizeMedium: '64px',
    textColor: '#8E8EA0'
  },

  Spin: {
    color: '#0369A1'
  }
}

/**
 * Dark theme configuration.
 */
export const claudeDarkTheme = {
  common: {
    // Primary color
    primaryColor: '#0369A1',
    primaryColorHover: '#075985',
    primaryColorPressed: '#0C4A6E',
    primaryColorSuppl: '#0369A1',

    // Semantic colors
    successColor: '#075985',
    warningColor: '#FBBF24',
    errorColor: '#F87171',
    infoColor: '#60A5FA',

    // Radius
    borderRadius: '8px',
    borderRadiusSmall: '6px',

    // Fonts
    fontFamily: "'Plus Jakarta Sans', 'PingFang SC', 'Microsoft YaHei', 'HarmonyOS Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: '14px',
    fontSizeMedium: '14px',
    fontSizeSmall: '13px',

    // Text colors for dark theme
    textColor1: '#ECECF1',
    textColor2: '#C5C5D2',
    textColor3: '#8E8EA0',

    // Background colors for dark theme
    bodyColor: '#212121',
    cardColor: '#2F2F2F',
    modalColor: '#2F2F2F',
    popoverColor: '#2F2F2F',

    // Border colors for dark theme
    dividerColor: '#4A4A4A',
    borderColor: '#4A4A4A',

    // Shadows for dark theme
    boxShadow1: '0 2px 8px rgba(0, 0, 0, 0.3)',
    boxShadow2: '0 4px 16px rgba(0, 0, 0, 0.4)',
    boxShadow3: '0 8px 24px rgba(0, 0, 0, 0.5)'
  },

  Button: {
    ...claudeTheme.Button
  },

  Input: {
    ...claudeTheme.Input,
    color: '#2F2F2F',
    colorFocus: '#3A3A3A',
    border: '1px solid #4A4A4A',
    borderHover: '1px solid #0369A1',
    borderFocus: '1px solid #0369A1'
  },

  Card: {
    ...claudeTheme.Card,
    color: '#2F2F2F',
    colorEmbedded: '#212121'
  },

  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '8px',
        heightMedium: '40px',
        color: '#2F2F2F',
        border: '1px solid #4A4A4A'
      }
    }
  },

  Switch: {
    ...claudeTheme.Switch
  },

  Tag: {
    ...claudeTheme.Tag
  },

  Modal: {
    ...claudeTheme.Modal,
    color: '#2F2F2F'
  },

  Message: {
    ...claudeTheme.Message
  },

  Notification: {
    ...claudeTheme.Notification
  },

  Form: {
    ...claudeTheme.Form
  },

  DataTable: {
    ...claudeTheme.DataTable,
    thColor: '#3A3A3A',
    tdColor: '#2F2F2F',
    borderColor: '#4A4A4A'
  },

  Dropdown: {
    ...claudeTheme.Dropdown,
    color: '#2F2F2F',
    optionColorHover: '#3A3A3A'
  },

  Popover: {
    ...claudeTheme.Popover,
    color: '#2F2F2F'
  },

  Tooltip: {
    ...claudeTheme.Tooltip,
    color: '#3A3A3A'
  },

  Empty: {
    ...claudeTheme.Empty
  },

  Spin: {
    ...claudeTheme.Spin
  }
}

