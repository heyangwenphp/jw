const { ProjectAgentProfileManager } = require('../managers/project-agent-profile-manager')
const { SkillsManager } = require('../managers/skills')
const { AgentsManager } = require('../managers/agents')

function setupProjectAgentProfileHandlers(ipcMain, configManager = null) {
  const manager = new ProjectAgentProfileManager({
    agentsManager: new AgentsManager(),
    skillsManager: new SkillsManager(),
    userDataPath: configManager?.userDataPath
  })

  const safe = async (label, fn) => {
    try {
      return await fn()
    } catch (err) {
      console.error(`[IPC] ${label} error:`, err)
      return { success: false, error: err.message || String(err) }
    }
  }

  ipcMain.handle('projectAgentProfiles:resolve', async (_event, params = {}) =>
    safe('projectAgentProfiles:resolve', () => manager.resolveCapabilityProjects(params.projectPath || params))
  )

  ipcMain.handle('projectAgentProfiles:resolveLegacy', async (_event, params = {}) =>
    safe('projectAgentProfiles:resolveLegacy', () => manager.resolve(params.projectPath || params))
  )

  ipcMain.handle('projectAgentProfiles:saveProfile', async (_event, params = {}) =>
    safe('projectAgentProfiles:saveProfile', () =>
      manager.saveProfile(params.projectPath, params.profile, { setDefault: params.setDefault })
    )
  )

  ipcMain.handle('projectAgentProfiles:deleteProfile', async (_event, params = {}) =>
    safe('projectAgentProfiles:deleteProfile', () =>
      manager.deleteProfile(params.projectPath, params.profileId)
    )
  )

  ipcMain.handle('projectAgentProfiles:setDefault', async (_event, params = {}) =>
    safe('projectAgentProfiles:setDefault', () =>
      manager.setDefault(params.projectPath, params.profileId)
    )
  )

  ipcMain.handle('projectAgentProfiles:togglePinned', async (_event, params = {}) =>
    safe('projectAgentProfiles:togglePinned', () =>
      manager.togglePinned(params.projectPath, params.type, params.id, params.pinned)
    )
  )

  ipcMain.handle('projectAgentProfiles:saveCapabilityProject', async (_event, params = {}) =>
    safe('projectAgentProfiles:saveCapabilityProject', () =>
      manager.saveCapabilityProject(params.project, { select: params.select })
    )
  )

  ipcMain.handle('projectAgentProfiles:deleteCapabilityProject', async (_event, params = {}) =>
    safe('projectAgentProfiles:deleteCapabilityProject', () =>
      manager.deleteCapabilityProject(params.projectId)
    )
  )

  ipcMain.handle('projectAgentProfiles:selectCapabilityProject', async (_event, params = {}) =>
    safe('projectAgentProfiles:selectCapabilityProject', () =>
      manager.selectCapabilityProject(params.projectId, params.projectPath)
    )
  )

  console.log('[IPC] Project agent profile handlers registered')
}

module.exports = { setupProjectAgentProfileHandlers }
