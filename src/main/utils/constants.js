/**
 * Global constants for main process.
 */

// API configuration defaults
const API_DEFAULTS = {
  BASE_URL: 'https://api.kimi.com/coding/',
  MODEL: 'kimi-for-coding',
  AUTH_TYPE: 'api_key',
  ANTHROPIC_VERSION: '2023-06-01'
};

// Proxy defaults
const PROXY_DEFAULTS = {
  HTTPS_PROXY: 'http://127.0.0.1:7890',
  HTTP_PROXY: 'http://127.0.0.1:7890'
};

// Timeout settings
const TIMEOUTS = {
  API_TEST: 30000,
  API_REQUEST: 120000
};

// Built-in service providers
const SERVICE_PROVIDERS = {
  kimi: {
    label: 'KIMI',
    baseUrl: 'https://api.kimi.com/coding/'
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com'
  }
};

const PROFILE_ICONS = [
  'K', 'D', 'A', 'B', 'C', 'E',
  'F', 'G', 'H', 'I', 'J', 'L',
  'M', 'N', 'O', 'P', 'Q', 'R'
];

module.exports = {
  API_DEFAULTS,
  PROXY_DEFAULTS,
  TIMEOUTS,
  SERVICE_PROVIDERS,
  PROFILE_ICONS
};
