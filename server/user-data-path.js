const path = require('path')
const os = require('os')
const fs = require('fs')

const WEB_DATA_APP_NAME = 'jedi-web'

function resolveDefaultWebUserDataPath({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir()
} = {}) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix

  if (platform === 'win32') {
    const appDataRoot = env.APPDATA || pathImpl.join(homeDir, 'AppData', 'Roaming')
    return pathImpl.join(appDataRoot, WEB_DATA_APP_NAME)
  }

  if (platform === 'darwin') {
    return pathImpl.join(homeDir, 'Library', 'Application Support', WEB_DATA_APP_NAME)
  }

  const xdgDataHome = String(env.XDG_DATA_HOME || '').trim()
  return pathImpl.join(xdgDataHome || pathImpl.join(homeDir, '.local', 'share'), WEB_DATA_APP_NAME)
}

function resolveWebUserDataPath({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  projectRoot = null
} = {}) {
  const configuredPath = String(env.JEDI_WEB_DATA_DIR || '').trim()
  if (configuredPath) {
    return path.resolve(configuredPath)
  }

  const useProjectDataDir = String(env.JEDI_WEB_USE_PROJECT_DATA_DIR || '').trim() === '1'
  if (projectRoot && useProjectDataDir) {
    const projectDataPath = path.resolve(projectRoot, 'data', WEB_DATA_APP_NAME)
    try {
      if (fs.existsSync(projectDataPath)) {
        return projectDataPath
      }
    } catch {
      // Fall through to the platform default if the deploy-local data path is inaccessible.
    }
  }

  return resolveDefaultWebUserDataPath({ env, platform, homeDir })
}

module.exports = {
  WEB_DATA_APP_NAME,
  resolveDefaultWebUserDataPath,
  resolveWebUserDataPath
}
