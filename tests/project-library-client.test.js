import { afterEach, describe, expect, it, vi } from 'vitest'

describe('project library web client API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls project library HTTP endpoints with credentials', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const {
      listProjectMasterRecords,
      createProjectMasterRecord,
      createProjectLibraryWorkspace,
      deleteProjectLibraryWorkspace,
      createProjectLibraryItem,
      updateProjectLibraryItem,
      deleteProjectLibraryItem,
      uploadProjectLibraryFile,
      bindProjectLibraryItemAgentSession
    } = await import('../src/renderer/client-api/api.js')

    await listProjectMasterRecords()
    await createProjectMasterRecord({ name: '碳中和', type: 'track' })
    await createProjectLibraryWorkspace({ masterRecordId: 1 })
    await deleteProjectLibraryWorkspace(2)
    await createProjectLibraryItem({ workspaceId: 2, name: '纪要', nodeType: 'folder' })
    await updateProjectLibraryItem({ id: 3, updates: { name: 'renamed.md' } })
    await deleteProjectLibraryItem(3)
    await uploadProjectLibraryFile({
      workspaceId: 2,
      parentId: 4,
      file: {
        name: 'deck.pdf',
        type: 'application/pdf',
        size: 7,
        arrayBuffer: async () => new TextEncoder().encode('PDFDATA').buffer
      }
    })
    await bindProjectLibraryItemAgentSession({ itemId: 3, sessionId: 'item-session-1' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/project-master-records'), expect.objectContaining({
      method: 'GET',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/project-master-records'), expect.objectContaining({
      method: 'POST',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringContaining('/api/project-library/workspaces'), expect.objectContaining({
      method: 'POST',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, expect.stringContaining('/api/project-library/workspaces/2'), expect.objectContaining({
      method: 'DELETE',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, expect.stringContaining('/api/project-library/workspaces/2/items'), expect.objectContaining({
      method: 'POST',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, expect.stringContaining('/api/project-library/items/3'), expect.objectContaining({
      method: 'PATCH',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, expect.stringContaining('/api/project-library/items/3'), expect.objectContaining({
      method: 'DELETE',
      credentials: 'include'
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, expect.stringContaining('/api/project-library/workspaces/2/uploads'), expect.objectContaining({
      method: 'POST',
      credentials: 'include'
    }))
    const uploadBody = JSON.parse(fetchMock.mock.calls[7][1].body)
    expect(uploadBody).toMatchObject({
      parentId: 4,
      name: 'deck.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 7,
      contentBase64: 'UERGREFUQQ=='
    })
    expect(fetchMock).toHaveBeenNthCalledWith(9, expect.stringContaining('/api/project-library/items/3/agent-session'), expect.objectContaining({
      method: 'POST',
      credentials: 'include'
    }))
  })
})
