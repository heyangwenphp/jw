const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')
const { ADMIN_PHONE } = require('../src/main/auth-manager')

const VALID_SKILL_ID = /^[a-zA-Z0-9-]+$/

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { name: '', description: '' }

  try {
    const parsed = yaml.load(match[1]) || {}
    return {
      name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : ''
    }
  } catch {
    return { name: '', description: '' }
  }
}

function mapSkill({ skillId, content, source, filePath = null, skillPath = null, disabled = false }) {
  const meta = parseSkillFrontmatter(content)
  return {
    id: skillId,
    name: meta.name || skillId,
    fullName: skillId,
    description: meta.description || '',
    source,
    filePath,
    skillPath,
    disabled
  }
}

function scanSkillFolders(skillsDir, source) {
  const skills = []
  if (!fs.existsSync(skillsDir)) return skills

  for (const item of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.') || item.name === '__pycache__') continue

    const skillPath = path.join(skillsDir, item.name)
    const skillMd = [
      { filePath: path.join(skillPath, 'SKILL.md'), disabled: false },
      { filePath: path.join(skillPath, 'skill.md'), disabled: false },
      { filePath: path.join(skillPath, 'SKILL.md.disabled'), disabled: true },
      { filePath: path.join(skillPath, 'skill.md.disabled'), disabled: true }
    ].find(candidate => fs.existsSync(candidate.filePath))
    if (!skillMd) continue

    const content = fs.readFileSync(skillMd.filePath, 'utf-8')
    skills.push(mapSkill({
      skillId: item.name,
      content,
      source,
      filePath: skillMd.filePath,
      skillPath,
      disabled: skillMd.disabled
    }))
  }

  return skills
}

function scanBuiltInSkills(projectRoot) {
  const skillsDir = path.join(projectRoot, 'skills')
  const skills = scanSkillFolders(skillsDir, 'built-in')
  if (!fs.existsSync(skillsDir)) return skills

  for (const item of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!item.isFile() || !item.name.endsWith('.zip')) continue

    try {
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(path.join(skillsDir, item.name))
      const entry = zip.getEntries().find(e =>
        !e.isDirectory && (e.entryName === 'SKILL.md' || e.entryName === 'skill.md')
      )
      if (!entry) continue

      const skillId = item.name.replace(/\.zip$/, '').replace(/-\d+\.\d+\.\d+$/, '')
      skills.push(mapSkill({
        skillId,
        content: entry.getData().toString('utf-8'),
        source: 'built-in'
      }))
    } catch (err) {
      console.error('[Skills] Failed to read zip:', item.name, err.message)
    }
  }

  return skills
}

function scanProjectSkills(projectPath) {
  if (!projectPath) return []
  return uniqueById([
    ...scanSkillFolders(path.join(projectPath, '.codex', 'skills'), 'project'),
    ...scanSkillFolders(path.join(projectPath, '.claude', 'skills'), 'project')
  ])
    .map(skill => ({
      ...skill,
      projectPath
    }))
}

function scanUserSkills(userSkillsDir) {
  return uniqueById(scanSkillFolders(userSkillsDir, 'user'))
}

function attachSkillPermissions(skill, { metadataStore, currentUser, fallbackOwnerUserId, sourceOverride } = {}) {
  if (!metadataStore) {
    return {
      ...skill,
      visibility: 'private',
      isOwner: skill.source === 'user',
      canUse: true,
      canView: true,
      canCopy: true,
      canManage: skill.source === 'user' || skill.source === 'project',
      canToggleVisibility: false
    }
  }

  const meta = metadataStore.ensure('skills', skill.id, {
    ownerUserId: fallbackOwnerUserId,
    visibility: 'private'
  })
  const permissions = metadataStore.permissions(meta, currentUser)
  return {
    ...skill,
    ...permissions,
    source: sourceOverride || skill.source
  }
}

function attachBuiltInSkillState(skill, { metadataStore, currentUser } = {}) {
  const state = metadataStore?.getBuiltInSkillState
    ? metadataStore.getBuiltInSkillState(skill.id)
    : { enabled: true, disabled: false, updatedBy: null, updatedAt: null }
  const canManage = Boolean(currentUser && (currentUser.phone === ADMIN_PHONE || currentUser.isAdmin === true))

  return {
    ...skill,
    disabled: Boolean(skill.disabled || state.disabled),
    enabled: !skill.disabled && state.enabled !== false,
    canUse: !skill.disabled && state.enabled !== false,
    canView: true,
    canCopy: !skill.disabled && state.enabled !== false,
    canManage,
    canToggleBuiltIn: canManage,
    globalDisabled: Boolean(state.disabled),
    disabledUpdatedBy: state.updatedBy || null,
    disabledUpdatedAt: state.updatedAt || null
  }
}

function publicSkillSourceDir({ skillId, userSkillsDir }) {
  return getWebSkillDir({ source: 'user', skillId, userSkillsDir })
}

function assertPublicSkillReadable({ skillId, metadataStore, currentUser }) {
  if (!metadataStore) {
    const err = new Error('Access denied')
    err.code = 'AUTH_FORBIDDEN'
    throw err
  }
  const meta = metadataStore.get('skills', skillId)
  const permissions = metadataStore.permissions(meta, currentUser)
  if (!permissions.canView || (!permissions.isOwner && permissions.visibility !== 'public')) {
    const err = new Error('Access denied')
    err.code = 'AUTH_FORBIDDEN'
    throw err
  }
}

function uniqueById(skills) {
  const seen = new Set()
  return skills.filter(skill => {
    if (seen.has(skill.id)) return false
    seen.add(skill.id)
    return true
  })
}

function cleanImportResult(validation) {
  const { _tempDir, ...publicResult } = validation
  return publicResult
}

function cleanupTempDir(tempDir) {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function safeRelativePath(relativePath) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')

  if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }

  return normalized
}

function safeJoin(baseDir, relativePath) {
  const targetPath = path.resolve(baseDir, relativePath)
  const basePath = path.resolve(baseDir)
  if (targetPath !== basePath && !targetPath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }
  return targetPath
}

function findSkillMd(skillDir) {
  return ['SKILL.md', 'skill.md']
    .map(fileName => path.join(skillDir, fileName))
    .find(candidate => fs.existsSync(candidate))
}

function findExistingSkillMd(skillDir) {
  return ['SKILL.md', 'skill.md', 'SKILL.md.disabled', 'skill.md.disabled']
    .map(fileName => path.join(skillDir, fileName))
    .find(candidate => fs.existsSync(candidate))
}

function validateSkillDir(skillDir, fallbackSkillId) {
  const skillId = fallbackSkillId || path.basename(skillDir)
  if (!VALID_SKILL_ID.test(skillId)) {
    return { valid: false, error: `Invalid skill directory name "${skillId}". Use letters, numbers and hyphens only.` }
  }

  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return { valid: false, error: `"${skillId}" is not a valid directory.` }
  }

  const skillMd = findSkillMd(skillDir)
  if (!skillMd) {
    return { valid: false, error: `"${skillId}" is missing SKILL.md.` }
  }

  const meta = parseSkillFrontmatter(fs.readFileSync(skillMd, 'utf-8'))
  if (!meta.name && !meta.description) {
    return { valid: false, error: `"${skillId}/SKILL.md" is missing valid YAML frontmatter.` }
  }

  return {
    valid: true,
    skillId,
    name: meta.name || skillId,
    description: meta.description || '',
    sourcePath: skillDir
  }
}

function inferFolderLabel(files) {
  const firstPath = files?.[0]?.relativePath || ''
  return safeRelativePath(firstPath).split('/')[0] || 'skill'
}

function materializeWebSkillImportSource(source) {
  if (!source || typeof source !== 'object') {
    throw new Error('Missing import source.')
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jedi-web-skill-import-'))
  try {
    if (source.type === 'folder') {
      const files = Array.isArray(source.files) ? source.files : []
      if (files.length === 0) throw new Error('No files were selected.')

      for (const file of files) {
        const relativePath = safeRelativePath(file.relativePath)
        const targetPath = safeJoin(tempDir, relativePath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, Buffer.from(file.dataBase64 || '', 'base64'))
      }

      return {
        tempDir,
        rootDir: tempDir,
        fallbackSkillId: inferFolderLabel(files).replace(/\.zip$/i, '')
      }
    }

    if (source.type === 'zip') {
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(Buffer.from(source.dataBase64 || '', 'base64'))
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const relativePath = safeRelativePath(entry.entryName)
        const targetPath = safeJoin(tempDir, relativePath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, entry.getData())
      }

      return {
        tempDir,
        rootDir: tempDir,
        fallbackSkillId: path.basename(source.fileName || 'skill', '.zip')
      }
    }

    throw new Error('Import source must be a folder or zip.')
  } catch (err) {
    cleanupTempDir(tempDir)
    throw err
  }
}

function validateMaterializedImportSource(materialized) {
  const result = { valid: true, type: null, skills: [], errors: [], _tempDir: materialized.tempDir }
  const rootDir = materialized.rootDir

  if (findSkillMd(rootDir)) {
    const validation = validateSkillDir(rootDir, materialized.fallbackSkillId)
    if (validation.valid) {
      result.skills.push(validation)
    } else {
      result.valid = false
      result.errors.push(validation.error)
    }
    return result
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__pycache__') continue
    const validation = validateSkillDir(path.join(rootDir, entry.name))
    if (validation.valid) {
      result.skills.push(validation)
    }
  }

  if (result.skills.length === 0) {
    result.valid = false
    result.errors.push('No valid skill directories were found.')
  }

  return result
}

function validateWebSkillImportPayload(source) {
  const materialized = materializeWebSkillImportSource(source)
  const result = validateMaterializedImportSource(materialized)
  result.type = source.type
  return result
}

function getWebSkillDir({ source, skillId, projectPath, userSkillsDir }) {
  if (!VALID_SKILL_ID.test(skillId || '')) {
    throw new Error(`Invalid skill id: ${skillId}`)
  }
  if (source === 'user') return path.join(userSkillsDir, skillId)
  if (source === 'project') {
    if (!projectPath) throw new Error('Project path is required.')
    return path.join(projectPath, '.codex', 'skills', skillId)
  }
  throw new Error(`Unsupported skill source: ${source}`)
}

function getExistingWebSkillMdPath({ source, skillId, projectPath, userSkillsDir }) {
  const skillDir = getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
  return findExistingSkillMd(skillDir) || path.join(skillDir, 'SKILL.md')
}

function checkWebSkillImportConflicts({ skills, projectPath, userSkillsDir }) {
  const existingIds = new Map()
  const existingNames = new Map()
  const sourceLabel = source => source === 'project' ? '项目' : '用户'
  for (const skill of [
    ...scanUserSkills(userSkillsDir),
    ...scanProjectSkills(projectPath)
  ]) {
    existingIds.set(skill.id, skill.source)
    existingNames.set(skill.name, { source: skill.source, skillId: skill.id })
  }

  return {
    results: skills.map(skill => {
      if (existingIds.has(skill.skillId)) {
        return {
          skillId: skill.skillId,
          name: skill.name,
          canImport: false,
          reason: `${sourceLabel(existingIds.get(skill.skillId))}中已存在同 ID 技能`
        }
      }
      if (existingNames.has(skill.name)) {
        const existing = existingNames.get(skill.name)
        return {
          skillId: skill.skillId,
          name: skill.name,
          canImport: false,
          reason: `${sourceLabel(existing.source)}中已存在同名技能（ID: ${existing.skillId}）`
        }
      }
      return { skillId: skill.skillId, name: skill.name, canImport: true, reason: null }
    })
  }
}

function copyDirRecursive(sourceDir, targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(sourceDir, targetDir, { recursive: true })
}

function importWebSkills({ source, targetSource = 'user', projectPath, selectedSkillIds = [], userSkillsDir, metadataStore, currentUser }) {
  let validation
  try {
    validation = validateWebSkillImportPayload(source)
    if (!validation.valid) return { success: false, errors: validation.errors }

    const selected = new Set(selectedSkillIds || [])
    const skillsToImport = selected.size > 0
      ? validation.skills.filter(skill => selected.has(skill.skillId))
      : validation.skills
    if (skillsToImport.length === 0) {
      return { success: false, errors: ['No selected skills can be imported.'] }
    }

    const conflictCheck = checkWebSkillImportConflicts({
      skills: skillsToImport,
      projectPath,
      userSkillsDir
    })
    const results = { imported: [], skipped: [], errors: [] }

    for (const skill of skillsToImport) {
      const conflict = conflictCheck.results.find(item => item.skillId === skill.skillId)
      if (conflict && !conflict.canImport) {
        results.skipped.push({ skillId: skill.skillId, name: skill.name, reason: conflict.reason })
        continue
      }

      try {
        copyDirRecursive(skill.sourcePath, getWebSkillDir({
          source: targetSource,
          skillId: skill.skillId,
          projectPath,
          userSkillsDir
        }))
        if (targetSource === 'user' && metadataStore) {
          metadataStore.ensure('skills', skill.skillId, {
            ownerUserId: currentUser?.id,
            visibility: 'private'
          })
        }
        results.imported.push({ skillId: skill.skillId, name: skill.name })
      } catch (err) {
        results.errors.push({ skillId: skill.skillId, error: err.message })
      }
    }

    return { success: true, ...results }
  } catch (err) {
    return { success: false, errors: [err.message] }
  } finally {
    cleanupTempDir(validation?._tempDir)
  }
}

function exportWebSkills({ source, scope = 'single', skillId, skillIds = [], projectPath, userSkillsDir }) {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  const ids = scope === 'single' ? [skillId] : skillIds
  const validIds = ids.filter(Boolean)
  if (validIds.length === 0) {
    return { success: false, error: 'No skills selected.' }
  }

  let count = 0
  for (const id of validIds) {
    const skillDir = getWebSkillDir({ source, skillId: id, projectPath, userSkillsDir })
    if (!fs.existsSync(skillDir)) continue
    zip.addLocalFolder(skillDir, id)
    count += 1
  }

  if (count === 0) {
    return { success: false, error: 'No exportable skills found.' }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return {
    success: true,
    buffer: zip.toBuffer(),
    filename: scope === 'single' ? `${validIds[0]}.zip` : `skills-export-${timestamp}.zip`,
    count
  }
}

function createWebSkillRaw({ source, skillId, rawContent, projectPath, userSkillsDir, metadataStore, currentUser, metadataDefaults = {} }) {
  try {
    if (!VALID_SKILL_ID.test(skillId || '')) {
      return { success: false, error: 'Skill ID can only contain letters, numbers and hyphens.' }
    }
    const skillDir = getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
    if (fs.existsSync(skillDir)) {
      return { success: false, error: `Skill "${skillId}" already exists.` }
    }
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), rawContent || '', 'utf-8')
    if (source === 'user' && metadataStore) {
      metadataStore.ensure('skills', skillId, {
        ...metadataDefaults,
        ownerUserId: currentUser?.id,
        visibility: 'private'
      })
    }
    return { success: true, skillPath: skillDir }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateWebSkillRaw({ source, skillId, rawContent, projectPath, userSkillsDir, metadataStore, currentUser }) {
  try {
    const skillDir = getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
    const skillMdPath = getExistingWebSkillMdPath({ source, skillId, projectPath, userSkillsDir })
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, error: `Skill "${skillId}" does not exist.` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('skills', skillId, currentUser)
    }
    fs.writeFileSync(skillMdPath, rawContent || '', 'utf-8')
    return { success: true, skillPath: skillDir }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function getWebSkillRawContent({ source, skillId, projectPath, userSkillsDir, metadataStore, currentUser }) {
  try {
    if (source === 'public') {
      assertPublicSkillReadable({ skillId, metadataStore, currentUser })
    }
    const skillDir = source === 'public'
      ? publicSkillSourceDir({ skillId, userSkillsDir })
      : getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
    const skillMdPath = findExistingSkillMd(skillDir) || path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, error: `Skill "${skillId}" does not exist.` }
    }
    return {
      success: true,
      content: fs.readFileSync(skillMdPath, 'utf-8'),
      skillPath: skillDir
    }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function deleteWebSkill({ source, skillId, projectPath, userSkillsDir, metadataStore, currentUser }) {
  try {
    const skillDir = getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
    if (!fs.existsSync(skillDir)) {
      return { success: false, error: `Skill "${skillId}" does not exist.` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('skills', skillId, currentUser)
    }
    fs.rmSync(skillDir, { recursive: true, force: true })
    if (source === 'user' && metadataStore) {
      metadataStore.remove('skills', skillId)
    }
    return { success: true }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function toggleWebSkillDisabled({ source, skillId, disabled, projectRoot = path.resolve(__dirname, '..'), projectPath, userSkillsDir, metadataStore, currentUser }) {
  try {
    if (source === 'built-in') {
      if (!metadataStore?.setBuiltInSkillEnabled) {
        return { success: false, error: 'Component metadata store is not available.' }
      }
      const exists = scanBuiltInSkills(projectRoot).some(skill => skill.id === skillId)
      if (!exists) {
        return { success: false, error: `Skill "${skillId}" does not exist.` }
      }
      return metadataStore.setBuiltInSkillEnabled(skillId, !disabled, currentUser)
    }

    if (source !== 'user' && source !== 'project') {
      return { success: false, error: `Unsupported skill source: ${source}` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('skills', skillId, currentUser)
    }

    const skillDir = getWebSkillDir({ source, skillId, projectPath, userSkillsDir })
    const activePath = ['SKILL.md', 'skill.md']
      .map(fileName => path.join(skillDir, fileName))
      .find(candidate => fs.existsSync(candidate))
    const disabledPath = ['SKILL.md.disabled', 'skill.md.disabled']
      .map(fileName => path.join(skillDir, fileName))
      .find(candidate => fs.existsSync(candidate))

    if (disabled) {
      if (!activePath) {
        return disabledPath
          ? { success: true, disabled: true }
          : { success: false, error: `Skill "${skillId}" does not exist.` }
      }
      const targetPath = `${activePath}.disabled`
      if (fs.existsSync(targetPath)) {
        return { success: false, error: `Disabled skill file already exists: ${path.basename(targetPath)}` }
      }
      fs.renameSync(activePath, targetPath)
      return { success: true, disabled: true }
    }

    if (!disabledPath) {
      return activePath
        ? { success: true, disabled: false }
        : { success: false, error: `Skill "${skillId}" does not exist.` }
    }
    const targetPath = disabledPath.replace(/\.disabled$/, '')
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `Enabled skill file already exists: ${path.basename(targetPath)}` }
    }
    fs.renameSync(disabledPath, targetPath)
    return { success: true, disabled: false }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function getCopySourceSkillDir({ fromSource, skillId, projectPath, userSkillsDir, projectRoot }) {
  if (fromSource === 'public') {
    return publicSkillSourceDir({ skillId, userSkillsDir })
  }
  if (fromSource === 'built-in') {
    return path.join(projectRoot, 'skills', skillId)
  }
  return getWebSkillDir({ source: fromSource, skillId, projectPath, userSkillsDir })
}

function copyWebSkill({ fromSource, skillId, toSource, newSkillId, projectPath, userSkillsDir, projectRoot, metadataStore, currentUser }) {
  try {
    const targetSkillId = newSkillId || skillId
    const sourceDir = getCopySourceSkillDir({
      fromSource,
      skillId,
      projectPath,
      userSkillsDir,
      projectRoot
    })
    const targetDir = getWebSkillDir({ source: toSource, skillId: targetSkillId, projectPath, userSkillsDir })

    if (!fs.existsSync(sourceDir)) {
      return { success: false, error: `Source skill "${skillId}" does not exist.` }
    }
    if (fromSource === 'public' && metadataStore) {
      const meta = metadataStore.get('skills', skillId)
      const permissions = metadataStore.permissions(meta, currentUser)
      if (!permissions.canCopy) {
        return { success: false, error: 'Access denied' }
      }
    }
    if (fs.existsSync(targetDir)) {
      return { success: false, error: `Skill "${targetSkillId}" already exists.` }
    }

    copyDirRecursive(sourceDir, targetDir)
    if (toSource === 'user' && metadataStore) {
      metadataStore.ensure('skills', targetSkillId, {
        ownerUserId: currentUser?.id,
        visibility: 'private'
      })
    }
    if (targetSkillId !== skillId) {
      const skillMdPath = path.join(targetDir, 'SKILL.md')
      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        fs.writeFileSync(skillMdPath, content.replace(/^(\s*name:\s*)(.*)$/m, `$1${targetSkillId}`), 'utf-8')
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function scanSkillsForWeb({
  projectRoot = path.resolve(__dirname, '..'),
  projectPath = projectRoot,
  userSkillsDir = null,
  metadataStore = null,
  currentUser = null
} = {}) {
  const currentUserId = currentUser?.id || null
  const scannedUser = userSkillsDir ? scanUserSkills(userSkillsDir) : []
  const user = []
  const publicSkills = []

  for (const skill of scannedUser) {
    const item = attachSkillPermissions(skill, {
      metadataStore,
      currentUser,
      fallbackOwnerUserId: currentUserId
    })
    if (item.isOwner || item.isAdmin) {
      user.push({ ...item, source: 'user' })
    } else if (item.visibility === 'public') {
      publicSkills.push({ ...item, source: 'public' })
    }
  }

  const project = uniqueById(scanProjectSkills(projectPath))
  const ownedIds = new Set([...user, ...project].map(skill => skill.id))
  const publicVisible = uniqueById(publicSkills).filter(skill => !ownedIds.has(skill.id))
  const projectIds = new Set([...user, ...publicVisible, ...project].map(skill => skill.id))
  const builtIn = uniqueById(scanBuiltInSkills(projectRoot))
    .filter(skill => !projectIds.has(skill.id))
    .map(skill => attachBuiltInSkillState(skill, { metadataStore, currentUser }))

  return {
    official: [],
    user,
    public: publicVisible,
    project,
    builtIn,
    all: [...project, ...user, ...publicVisible, ...builtIn]
  }
}

function updateWebSkillVisibility({ skillId, visibility, metadataStore, currentUser }) {
  try {
    if (!metadataStore) {
      return { success: false, error: 'Component metadata store is not available.' }
    }
    if (!VALID_SKILL_ID.test(skillId || '')) {
      return { success: false, error: `Invalid skill id: ${skillId}` }
    }
    metadataStore.assertOwner('skills', skillId, currentUser)
    const meta = metadataStore.setVisibility('skills', skillId, {
      ownerUserId: currentUser?.id,
      visibility
    })
    return { success: true, metadata: meta }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function findImportConflict({ skill, projectPath, userSkillsDir }) {
  const candidates = [
    ...scanUserSkills(userSkillsDir),
    ...scanProjectSkills(projectPath)
  ]
  const sameId = candidates.find(item => item.id === skill.skillId)
  if (sameId) {
    return {
      conflictType: 'id',
      existingSource: sameId.source,
      existingSkillId: sameId.id,
      reason: `${sameId.source} already has a skill with the same ID.`
    }
  }

  const sameName = candidates.find(item => item.name === skill.name)
  if (sameName) {
    return {
      conflictType: 'name',
      existingSource: sameName.source,
      existingSkillId: sameName.id,
      reason: `${sameName.source} already has a skill with the same name (ID: ${sameName.id}).`
    }
  }

  return null
}

function importWebSkillsWithOverwrite({ source, targetSource = 'user', projectPath, selectedSkillIds = [], overwriteExisting = false, userSkillsDir, metadataStore, currentUser }) {
  let validation
  try {
    validation = validateWebSkillImportPayload(source)
    if (!validation.valid) return { success: false, errors: validation.errors }

    const selected = new Set(selectedSkillIds || [])
    const skillsToImport = selected.size > 0
      ? validation.skills.filter(skill => selected.has(skill.skillId))
      : validation.skills
    if (skillsToImport.length === 0) {
      return { success: false, errors: ['No selected skills can be imported.'] }
    }

    const results = { imported: [], skipped: [], errors: [] }

    for (const skill of skillsToImport) {
      const conflict = findImportConflict({ skill, projectPath, userSkillsDir })
      const canOverwrite = overwriteExisting &&
        conflict?.conflictType === 'id' &&
        conflict.existingSource === targetSource

      if (conflict && !canOverwrite) {
        results.skipped.push({ skillId: skill.skillId, name: skill.name, reason: conflict.reason })
        continue
      }

      try {
        const targetDir = getWebSkillDir({
          source: targetSource,
          skillId: skill.skillId,
          projectPath,
          userSkillsDir
        })
        copyDirRecursive(skill.sourcePath, targetDir)
        if (targetSource === 'user' && metadataStore) {
          metadataStore.ensure('skills', skill.skillId, {
            ownerUserId: currentUser?.id,
            visibility: 'private'
          })
        }
        results.imported.push({ skillId: skill.skillId, name: skill.name, overwritten: canOverwrite })
      } catch (err) {
        results.errors.push({ skillId: skill.skillId, error: err.message })
      }
    }

    return { success: true, ...results }
  } catch (err) {
    return { success: false, errors: [err.message] }
  } finally {
    cleanupTempDir(validation?._tempDir)
  }
}

module.exports = {
  parseSkillFrontmatter,
  scanSkillsForWeb,
  validateWebSkillImportPayload,
  cleanImportResult,
  createWebSkillRaw,
  updateWebSkillRaw,
  getWebSkillRawContent,
  deleteWebSkill,
  toggleWebSkillDisabled,
  copyWebSkill,
  importWebSkills: importWebSkillsWithOverwrite,
  exportWebSkills,
  updateWebSkillVisibility,
  attachBuiltInSkillState
}
