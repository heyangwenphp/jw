const fs = require('fs')
const fsp = require('fs').promises
const os = require('os')
const path = require('path')

const DEFAULT_RETENTION_DAYS = 7
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000
const DEFAULT_START_DELAY_MS = 60 * 1000

function defaultOutputBaseDir() {
  return path.join(os.homedir(), 'jedi-web-agent-output')
}

function toRetentionMs(days) {
  const value = Number(days)
  const normalized = Number.isFinite(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS
  return normalized * 24 * 60 * 60 * 1000
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target))
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function removeEntry(entryPath, rootPath) {
  if (!isPathInside(rootPath, entryPath)) return false
  await fsp.rm(entryPath, { recursive: true, force: true })
  return true
}

function parseDateDir(name) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name)
  if (!match) return null
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function shouldRemoveProcessedEntry(entry, stat, cutoffMs) {
  const date = parseDateDir(entry.name)
  if (date) return date.getTime() < cutoffMs
  return stat.mtimeMs < cutoffMs
}

async function cleanupDirectChildren({ rootPath, cutoffMs, shouldRemove = (entry, stat) => stat.mtimeMs < cutoffMs }) {
  const stats = { scanned: 0, removed: 0, failed: 0, skipped: 0 }
  let entries
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return stats
    throw err
  }

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)
    stats.scanned += 1
    try {
      const stat = await fsp.stat(entryPath)
      if (!entry.isDirectory() && !entry.isFile()) {
        stats.skipped += 1
        continue
      }
      if (!shouldRemove(entry, stat)) {
        stats.skipped += 1
        continue
      }
      if (await removeEntry(entryPath, rootPath)) {
        stats.removed += 1
      } else {
        stats.skipped += 1
      }
    } catch (err) {
      if (err.code === 'ENOENT') continue
      stats.failed += 1
      console.warn('[AipinOutputCleanup] Failed to remove old output:', {
        path: entryPath,
        error: err.message
      })
    }
  }

  return stats
}

async function cleanupAipinOutputs({
  userDataPath,
  outputBaseDir = defaultOutputBaseDir(),
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = () => Date.now()
} = {}) {
  if (!userDataPath) throw new Error('userDataPath is required')

  const cutoffMs = Number(now()) - toRetentionMs(retentionDays)
  const resolvedUserDataPath = path.resolve(userDataPath)
  const resolvedOutputBaseDir = path.resolve(outputBaseDir || defaultOutputBaseDir())
  const processedRoot = path.join(resolvedUserDataPath, 'aipin-processed')
  const agentRoot = path.join(resolvedOutputBaseDir, 'aipin-data')

  const processed = await cleanupDirectChildren({
    rootPath: processedRoot,
    cutoffMs,
    shouldRemove: (entry, stat) => shouldRemoveProcessedEntry(entry, stat, cutoffMs)
  })
  const agent = await cleanupDirectChildren({
    rootPath: agentRoot,
    cutoffMs
  })

  return {
    retentionDays,
    cutoffAt: new Date(cutoffMs).toISOString(),
    roots: {
      processedRoot,
      agentRoot
    },
    processed,
    agent
  }
}

function startAipinOutputCleanupSchedule({
  userDataPath,
  outputBaseDir,
  getOutputBaseDir = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  intervalMs = DEFAULT_INTERVAL_MS,
  startDelayMs = DEFAULT_START_DELAY_MS,
  now
} = {}) {
  let stopped = false
  let timer = null

  const run = async () => {
    if (stopped) return
    try {
      const resolvedOutputBaseDir = typeof getOutputBaseDir === 'function'
        ? getOutputBaseDir()
        : outputBaseDir
      const result = await cleanupAipinOutputs({
        userDataPath,
        outputBaseDir: resolvedOutputBaseDir || defaultOutputBaseDir(),
        retentionDays,
        now
      })
      console.log('[AipinOutputCleanup] Completed:', result)
    } catch (err) {
      console.warn('[AipinOutputCleanup] Failed:', err.message)
    } finally {
      if (!stopped) {
        timer = setTimeout(run, intervalMs)
        if (typeof timer.unref === 'function') timer.unref()
      }
    }
  }

  timer = setTimeout(run, startDelayMs)
  if (typeof timer.unref === 'function') timer.unref()

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }
}

module.exports = {
  cleanupAipinOutputs,
  defaultOutputBaseDir,
  startAipinOutputCleanupSchedule
}
