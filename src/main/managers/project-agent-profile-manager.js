const fs = require('fs')
const path = require('path')
const os = require('os')
const { atomicWriteJson } = require('../utils/path-utils')

const CONFIG_FILE_NAME = 'jedi-agent-profiles.json'
const CAPABILITY_PROJECTS_FILE_NAME = 'jedi-capability-projects.json'

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeRef(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const id = normalizeId(value)
    return id ? { id, source: 'auto' } : null
  }
  if (typeof value === 'object') {
    const id = normalizeId(value.id || value.name)
    if (!id) return null
    return {
      id,
      source: normalizeId(value.source) || 'auto'
    }
  }
  return null
}

function refId(value) {
  return normalizeRef(value)?.id || ''
}

function uniqueRefs(values) {
  const seen = new Set()
  const refs = []
  for (const value of toArray(values)) {
    const ref = normalizeRef(value)
    if (!ref || seen.has(ref.id)) continue
    seen.add(ref.id)
    refs.push(ref.id)
  }
  return refs
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || `profile-${Date.now()}`
}

class ProjectAgentProfileManager {
  constructor({ agentsManager, skillsManager, userDataPath } = {}) {
    this.agentsManager = agentsManager
    this.skillsManager = skillsManager
    this.userDataPath = userDataPath || this._resolveUserDataPath()
  }

  _resolveUserDataPath() {
    try {
      const { app } = require('electron')
      return app?.getPath?.('userData') || path.join(os.homedir(), '.config', 'jedi-web')
    } catch {
      return path.join(os.homedir(), '.config', 'jedi-web')
    }
  }

  getCapabilityProjectsPath() {
    return path.join(this.userDataPath, CAPABILITY_PROJECTS_FILE_NAME)
  }

  getConfigPath(projectPath) {
    const root = this._validateProjectPath(projectPath)
    return path.join(root, '.claude', CONFIG_FILE_NAME)
  }

  createDefaultConfig() {
    return {
      version: 1,
      defaultProfileId: '',
      pinnedAgents: [],
      pinnedSkills: [],
      profiles: []
    }
  }

  readConfig(projectPath) {
    const configPath = this.getConfigPath(projectPath)
    if (!fs.existsSync(configPath)) return this.createDefaultConfig()
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return this.normalizeConfig(parsed)
    } catch (err) {
      throw new Error(`Failed to read project agent profiles: ${err.message}`)
    }
  }

  writeConfig(projectPath, config) {
    const configPath = this.getConfigPath(projectPath)
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    atomicWriteJson(configPath, this.normalizeConfig(config))
    return configPath
  }

  normalizeConfig(config) {
    const source = config && typeof config === 'object' ? config : {}
    const profiles = toArray(source.profiles)
      .map(profile => this.normalizeProfile(profile))
      .filter(profile => profile.id)
    const profileIds = new Set()
    const dedupedProfiles = []
    for (const profile of profiles) {
      if (profileIds.has(profile.id)) continue
      profileIds.add(profile.id)
      dedupedProfiles.push(profile)
    }

    const defaultProfileId = normalizeId(source.defaultProfileId)
    return {
      version: 1,
      defaultProfileId: profileIds.has(defaultProfileId) ? defaultProfileId : '',
      pinnedAgents: uniqueRefs(source.pinnedAgents),
      pinnedSkills: uniqueRefs(source.pinnedSkills),
      profiles: dedupedProfiles
    }
  }

  normalizeProfile(profile) {
    const source = profile && typeof profile === 'object' ? profile : {}
    const id = normalizeId(source.id) || slugify(source.name)
    const agent = refId(source.agent)
    const skills = uniqueRefs(source.skills)
    return {
      id,
      name: normalizeId(source.name) || id,
      description: normalizeId(source.description),
      agent,
      skills,
      createdAt: normalizeId(source.createdAt) || new Date().toISOString(),
      updatedAt: normalizeId(source.updatedAt) || new Date().toISOString()
    }
  }

  createDefaultCapabilityConfig() {
    return {
      version: 1,
      selectedProjectId: '',
      folderBindings: {},
      projects: []
    }
  }

  readCapabilityConfig() {
    const configPath = this.getCapabilityProjectsPath()
    if (!fs.existsSync(configPath)) return this.createDefaultCapabilityConfig()
    try {
      return this.normalizeCapabilityConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')))
    } catch (err) {
      throw new Error(`Failed to read capability projects: ${err.message}`)
    }
  }

  writeCapabilityConfig(config) {
    const configPath = this.getCapabilityProjectsPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    atomicWriteJson(configPath, this.normalizeCapabilityConfig(config))
    return configPath
  }

  normalizeCapabilityConfig(config) {
    const source = config && typeof config === 'object' ? config : {}
    const projects = toArray(source.projects)
      .map(project => this.normalizeCapabilityProject(project))
      .filter(project => project.id)
    const ids = new Set()
    const deduped = []
    for (const project of projects) {
      if (ids.has(project.id)) continue
      ids.add(project.id)
      deduped.push(project)
    }
    const selectedProjectId = normalizeId(source.selectedProjectId)
    const folderBindings = {}
    if (source.folderBindings && typeof source.folderBindings === 'object') {
      for (const [folder, projectId] of Object.entries(source.folderBindings)) {
        const key = this._normalizeFolderKey(folder)
        const id = normalizeId(projectId)
        if (key && ids.has(id)) folderBindings[key] = id
      }
    }
    return {
      version: 1,
      selectedProjectId: ids.has(selectedProjectId) ? selectedProjectId : '',
      folderBindings,
      projects: deduped
    }
  }

  normalizeCapabilityProject(project) {
    const source = project && typeof project === 'object' ? project : {}
    const id = normalizeId(source.id) || slugify(source.name)
    const profiles = toArray(source.profiles)
      .map(profile => this.normalizeProfile(profile))
      .filter(profile => profile.id)
    const profileIds = new Set(profiles.map(profile => profile.id))
    const defaultProfileId = normalizeId(source.defaultProfileId)
    const now = new Date().toISOString()
    return {
      id,
      name: normalizeId(source.name) || id,
      description: normalizeId(source.description),
      agents: uniqueRefs(source.agents),
      skills: uniqueRefs(source.skills),
      profiles,
      defaultProfileId: profileIds.has(defaultProfileId) ? defaultProfileId : '',
      createdAt: normalizeId(source.createdAt) || now,
      updatedAt: normalizeId(source.updatedAt) || now
    }
  }

  async resolveCapabilityProjects(runtimeProjectPath = '') {
    const runtimePath = this._tryResolveProjectPath(runtimeProjectPath)
    const config = this.readCapabilityConfig()
    await this._migrateLegacyProjectConfig(config, runtimePath)

    const [agents, skills] = await Promise.all([
      this.agentsManager.getAllAgents(runtimePath || null),
      this.skillsManager.getAllSkills(runtimePath || null)
    ])
    const agentIndex = this._buildIndex(agents.all || [], ['project', 'user', 'plugin', 'built-in'])
    const skillIndex = this._buildIndex(skills.all || [], ['project', 'user', 'official', 'built-in'])
    const selectedProjectId = this._resolveSelectedCapabilityProjectId(config, runtimePath)
    const selectedProject = config.projects.find(project => project.id === selectedProjectId) || config.projects[0] || null
    const resolvedProjects = config.projects.map(project =>
      this._resolveCapabilityProject(project, agentIndex, skillIndex)
    )
    const resolvedSelectedProject = selectedProject
      ? this._resolveCapabilityProject(selectedProject, agentIndex, skillIndex)
      : null

    return {
      success: true,
      mode: 'capability-projects',
      configPath: this.getCapabilityProjectsPath(),
      runtimeProjectPath: runtimePath,
      config,
      projects: resolvedProjects,
      selectedProjectId: resolvedSelectedProject?.id || '',
      selectedProject: resolvedSelectedProject,
      availableAgents: agents,
      availableSkills: skills
    }
  }

  saveCapabilityProject(project, options = {}) {
    const config = this.readCapabilityConfig()
    const normalized = this.normalizeCapabilityProject(project)
    if (normalized.agents.length === 0 && normalized.skills.length === 0 && normalized.profiles.length === 0) {
      return { success: false, error: 'Capability project must include at least one agent, skill, or profile' }
    }
    const now = new Date().toISOString()
    const existingIndex = config.projects.findIndex(item => item.id === normalized.id)
    if (existingIndex >= 0) {
      normalized.createdAt = config.projects[existingIndex].createdAt || normalized.createdAt || now
      normalized.updatedAt = now
      config.projects.splice(existingIndex, 1, normalized)
    } else {
      normalized.createdAt = normalized.createdAt || now
      normalized.updatedAt = now
      config.projects.push(normalized)
    }
    if (options.select) config.selectedProjectId = normalized.id
    const configPath = this.writeCapabilityConfig(config)
    return { success: true, project: normalized, config: this.normalizeCapabilityConfig(config), configPath }
  }

  deleteCapabilityProject(projectId) {
    const id = normalizeId(projectId)
    if (!id) return { success: false, error: 'Missing projectId' }
    const config = this.readCapabilityConfig()
    config.projects = config.projects.filter(project => project.id !== id)
    if (config.selectedProjectId === id) config.selectedProjectId = config.projects[0]?.id || ''
    for (const [folder, boundProjectId] of Object.entries(config.folderBindings || {})) {
      if (boundProjectId === id) delete config.folderBindings[folder]
    }
    const configPath = this.writeCapabilityConfig(config)
    return { success: true, config: this.normalizeCapabilityConfig(config), configPath }
  }

  selectCapabilityProject(projectId, runtimeProjectPath = '') {
    const id = normalizeId(projectId)
    const config = this.readCapabilityConfig()
    if (id && !config.projects.some(project => project.id === id)) {
      return { success: false, error: `Capability project not found: ${id}` }
    }
    const folderKey = this._normalizeFolderKey(runtimeProjectPath)
    if (folderKey) config.folderBindings[folderKey] = id
    config.selectedProjectId = id
    const configPath = this.writeCapabilityConfig(config)
    return { success: true, config: this.normalizeCapabilityConfig(config), configPath }
  }

  async resolve(projectPath) {
    const configPath = this.getConfigPath(projectPath)
    const config = this.readConfig(projectPath)
    const [agents, skills] = await Promise.all([
      this.agentsManager.getAllAgents(projectPath),
      this.skillsManager.getAllSkills(projectPath)
    ])

    const agentIndex = this._buildIndex(agents.all || [], ['project', 'user', 'plugin'])
    const skillIndex = this._buildIndex(skills.all || [], ['project', 'user', 'official', 'built-in'])

    const profiles = config.profiles.map(profile =>
      this._resolveProfile(profile, agentIndex, skillIndex)
    )
    const defaultProfile = profiles.find(profile => profile.id === config.defaultProfileId) || null
    const pinnedAgents = config.pinnedAgents.map(id => this._resolveRef('agent', id, agentIndex))
    const pinnedSkills = config.pinnedSkills.map(id => this._resolveRef('skill', id, skillIndex))

    const missingRefs = {
      agents: this._collectMissing([...profiles.flatMap(p => p.missingRefs), ...pinnedAgents], 'agent'),
      skills: this._collectMissing([...profiles.flatMap(p => p.missingRefs), ...pinnedSkills], 'skill')
    }

    return {
      success: true,
      configPath,
      config,
      defaultProfile,
      profiles,
      pinnedAgents,
      pinnedSkills,
      availableAgents: agents,
      availableSkills: skills,
      missingRefs
    }
  }

  saveProfile(projectPath, profile, options = {}) {
    const config = this.readConfig(projectPath)
    const normalized = this.normalizeProfile(profile)
    if (!normalized.agent && normalized.skills.length === 0) {
      return { success: false, error: 'Profile must include an agent or at least one skill' }
    }

    const now = new Date().toISOString()
    const existingIndex = config.profiles.findIndex(item => item.id === normalized.id)
    if (existingIndex >= 0) {
      normalized.createdAt = config.profiles[existingIndex].createdAt || normalized.createdAt || now
      normalized.updatedAt = now
      config.profiles.splice(existingIndex, 1, normalized)
    } else {
      normalized.createdAt = normalized.createdAt || now
      normalized.updatedAt = now
      config.profiles.push(normalized)
    }
    if (options.setDefault) config.defaultProfileId = normalized.id
    const configPath = this.writeConfig(projectPath, config)
    return { success: true, profile: normalized, config: this.normalizeConfig(config), configPath }
  }

  deleteProfile(projectPath, profileId) {
    const id = normalizeId(profileId)
    if (!id) return { success: false, error: 'Missing profileId' }
    const config = this.readConfig(projectPath)
    config.profiles = config.profiles.filter(profile => profile.id !== id)
    if (config.defaultProfileId === id) config.defaultProfileId = ''
    const configPath = this.writeConfig(projectPath, config)
    return { success: true, config: this.normalizeConfig(config), configPath }
  }

  setDefault(projectPath, profileId) {
    const id = normalizeId(profileId)
    const config = this.readConfig(projectPath)
    if (id && !config.profiles.some(profile => profile.id === id)) {
      return { success: false, error: `Profile not found: ${id}` }
    }
    config.defaultProfileId = id
    const configPath = this.writeConfig(projectPath, config)
    return { success: true, config: this.normalizeConfig(config), configPath }
  }

  togglePinned(projectPath, type, id, pinned) {
    const normalizedType = type === 'agent' ? 'agent' : 'skill'
    const normalizedId = normalizeId(id)
    if (!normalizedId) return { success: false, error: 'Missing id' }
    const key = normalizedType === 'agent' ? 'pinnedAgents' : 'pinnedSkills'
    const config = this.readConfig(projectPath)
    const current = new Set(config[key])
    if (pinned) current.add(normalizedId)
    else current.delete(normalizedId)
    config[key] = Array.from(current)
    const configPath = this.writeConfig(projectPath, config)
    return { success: true, config: this.normalizeConfig(config), configPath }
  }

  _resolveCapabilityProject(project, agentIndex, skillIndex) {
    const agents = project.agents.map(id => this._resolveRef('agent', id, agentIndex))
    const skills = project.skills.map(id => this._resolveRef('skill', id, skillIndex))
    const profiles = project.profiles.map(profile => this._resolveProfile(profile, agentIndex, skillIndex))
    const defaultProfile = profiles.find(profile => profile.id === project.defaultProfileId) || profiles[0] || null
    const missingRefs = [
      ...agents.filter(agent => agent.missing),
      ...skills.filter(skill => skill.missing),
      ...profiles.flatMap(profile => profile.missingRefs || [])
    ]
    const invocationRefs = [
      ...agents
        .filter(agent => !agent.missing)
        .map(agent => ({ type: 'agent', id: agent.id, name: agent.name, description: agent.description })),
      ...skills
        .filter(skill => !skill.missing)
        .map(skill => ({ type: 'skill', id: skill.id, name: skill.name, description: skill.description }))
    ]
    return {
      ...project,
      agents,
      skills,
      profiles,
      defaultProfile,
      missing: missingRefs.length > 0,
      missingRefs,
      usable: invocationRefs.length > 0 || profiles.some(profile => profile.usable),
      invocationRefs
    }
  }

  _resolveSelectedCapabilityProjectId(config, runtimeProjectPath) {
    const folderKey = this._normalizeFolderKey(runtimeProjectPath)
    const bound = folderKey ? normalizeId(config.folderBindings?.[folderKey]) : ''
    if (bound && config.projects.some(project => project.id === bound)) return bound
    if (config.selectedProjectId && config.projects.some(project => project.id === config.selectedProjectId)) {
      return config.selectedProjectId
    }
    return config.projects[0]?.id || ''
  }

  async _migrateLegacyProjectConfig(config, runtimeProjectPath) {
    if (!runtimeProjectPath || config.projects.length > 0) return
    const legacyPath = path.join(runtimeProjectPath, '.claude', CONFIG_FILE_NAME)
    if (!fs.existsSync(legacyPath)) return
    const legacy = this.readConfig(runtimeProjectPath)
    if (legacy.profiles.length === 0 && legacy.pinnedAgents.length === 0 && legacy.pinnedSkills.length === 0) return
    const project = this.normalizeCapabilityProject({
      id: slugify(path.basename(runtimeProjectPath) || 'capability-project'),
      name: path.basename(runtimeProjectPath) || '能力项目',
      description: '由当前项目目录的快捷组合自动迁移',
      agents: legacy.pinnedAgents,
      skills: legacy.pinnedSkills,
      profiles: legacy.profiles,
      defaultProfileId: legacy.defaultProfileId
    })
    config.projects.push(project)
    config.selectedProjectId = project.id
    const folderKey = this._normalizeFolderKey(runtimeProjectPath)
    if (folderKey) config.folderBindings[folderKey] = project.id
    this.writeCapabilityConfig(config)
  }

  _tryResolveProjectPath(projectPath) {
    const root = normalizeId(projectPath)
    if (!root) return ''
    try {
      const resolved = path.resolve(root)
      return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : ''
    } catch {
      return ''
    }
  }

  _normalizeFolderKey(projectPath) {
    const resolved = this._tryResolveProjectPath(projectPath)
    return resolved ? resolved.toLowerCase() : ''
  }

  _validateProjectPath(projectPath) {
    const root = normalizeId(projectPath)
    if (!root) throw new Error('Missing projectPath')
    const resolved = path.resolve(root)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Invalid projectPath: ${root}`)
    }
    return resolved
  }

  _buildIndex(items, sourceOrder) {
    const order = new Map(sourceOrder.map((source, index) => [source, index]))
    const sorted = [...items].sort((a, b) => {
      const left = order.has(a.source) ? order.get(a.source) : 99
      const right = order.has(b.source) ? order.get(b.source) : 99
      if (left !== right) return left - right
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
    const index = new Map()
    for (const item of sorted) {
      const ids = [item.id, item.name, item.fullName].map(normalizeId).filter(Boolean)
      for (const id of ids) {
        if (!index.has(id)) index.set(id, item)
      }
    }
    return index
  }

  _resolveProfile(profile, agentIndex, skillIndex) {
    const agent = profile.agent ? this._resolveRef('agent', profile.agent, agentIndex) : null
    const skills = profile.skills.map(id => this._resolveRef('skill', id, skillIndex))
    const missingRefs = [
      ...(agent?.missing ? [agent] : []),
      ...skills.filter(skill => skill.missing)
    ]
    const invocationRefs = [
      ...(agent && !agent.missing ? [{ type: 'agent', id: agent.id, name: agent.name, description: agent.description }] : []),
      ...skills
        .filter(skill => !skill.missing)
        .map(skill => ({ type: 'skill', id: skill.id, name: skill.name, description: skill.description }))
    ]
    return {
      ...profile,
      agent,
      skills,
      missing: missingRefs.length > 0,
      missingRefs,
      usable: invocationRefs.length > 0 && missingRefs.length === 0,
      invocationRefs
    }
  }

  _resolveRef(type, id, index) {
    const normalizedId = normalizeId(id)
    const item = index.get(normalizedId)
    if (!item) {
      return {
        id: normalizedId,
        type,
        name: normalizedId,
        description: '',
        source: 'missing',
        missing: true
      }
    }
    return {
      id: item.fullName || item.id || normalizedId,
      rawId: item.id || normalizedId,
      type,
      name: item.name || item.id || normalizedId,
      description: item.description || '',
      source: item.source || 'unknown',
      missing: false,
      editable: item.editable,
      filePath: item.filePath || item.agentPath || '',
      skillPath: item.skillPath || ''
    }
  }

  _collectMissing(refs, type) {
    const seen = new Set()
    const result = []
    for (const ref of refs) {
      if (!ref?.missing || ref.type !== type || seen.has(ref.id)) continue
      seen.add(ref.id)
      result.push(ref)
    }
    return result
  }
}

module.exports = {
  ProjectAgentProfileManager,
  CONFIG_FILE_NAME,
  CAPABILITY_PROJECTS_FILE_NAME
}
