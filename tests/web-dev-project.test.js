import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('web dev default project', () => {
  it('exposes the current repo as a project in the web polyfill', () => {
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')

    expect(apiSource).toContain('export async function listProjects()')
    expect(apiSource).toContain("api.get('/api/projects')")
    expect(polyfillSource).toContain('getProjects: listProjects')
    expect(serverSource).toContain("app.get('/api/projects'")
  })
})
