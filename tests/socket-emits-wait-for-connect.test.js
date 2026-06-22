import { afterEach, describe, expect, it, vi } from 'vitest'

describe('web socket emit connection timing', () => {
  afterEach(() => {
    vi.doUnmock('socket.io-client')
    vi.resetModules()
  })

  it('waits for the socket to connect before emitting events', async () => {
    const listeners = new Map()
    const socket = {
      connected: false,
      on: vi.fn((event, callback) => {
        listeners.set(event, callback)
        return socket
      }),
      emit: vi.fn((event, data, callback) => {
        callback({ success: true, event, data })
      })
    }

    vi.doMock('socket.io-client', () => ({
      io: vi.fn(() => socket)
    }))

    const { emitSocket } = await import('../src/renderer/client-api/api.js?socket-wait-test')
    const pending = emitSocket('agent:sendMessage', { sessionId: 'session-1' }, 1000)

    await Promise.resolve()
    expect(socket.emit).not.toHaveBeenCalled()

    socket.connected = true
    listeners.get('connect')()

    await expect(pending).resolves.toEqual({
      success: true,
      event: 'agent:sendMessage',
      data: { sessionId: 'session-1' }
    })
    expect(socket.emit).toHaveBeenCalledWith('agent:sendMessage', { sessionId: 'session-1' }, expect.any(Function))
  })
})
