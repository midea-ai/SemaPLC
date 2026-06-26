import { describe, it, expect, vi, afterEach } from 'vitest'
import { RuntimeClient } from '../src/client/runtime.js'

// Minimal axios mock factory
function makeAxios(responses: Record<string, any>) {
  return {
    post: vi.fn(async (url: string, data?: any, cfg?: any) => {
      const key = `POST:${url.split('/api')[1] ?? url}`
      if (key in responses) return { data: responses[key] }
      throw Object.assign(new Error(`Unexpected POST ${url}`), { response: { status: 404 } })
    }),
    get: vi.fn(async (url: string, cfg?: any) => {
      const key = `GET:${url.split('/api')[1] ?? url}`
      if (key in responses) return { data: responses[key] }
      throw Object.assign(new Error(`Unexpected GET ${url}`), { response: { status: 404 } })
    }),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('RuntimeClient', () => {
  it('authenticates and returns status', async () => {
    const ax = makeAxios({
      'POST:/login': { access_token: 'tok123' },
      'GET:/status': { status: 'RUNNING' },
    })
    const client = new RuntimeClient('https://localhost:8443', 'admin', 'pw', ax as any)
    const status = await client.getStatus()
    expect(status).toBe('RUNNING')
    expect(ax.post).toHaveBeenCalledWith(
      expect.stringContaining('/login'),
      expect.objectContaining({ username: 'admin' }),
      expect.anything(),
    )
  })

  it('throws when login fails', async () => {
    const ax = makeAxios({ 'POST:/login': {} })  // no access_token
    const client = new RuntimeClient('https://localhost:8443', 'admin', 'bad', ax as any)
    await expect(client.getStatus()).rejects.toThrow('Authentication failed')
  })

  it('polls compilation status until SUCCESS', async () => {
    let call = 0
    const ax = {
      post: vi.fn().mockResolvedValue({ data: { access_token: 'tok' } }),
      get: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/compilation-status')) {
          call++
          return { data: { status: call < 2 ? 'COMPILING' : 'SUCCESS', logs: ['done'] } }
        }
        return { data: {} }
      }),
    }
    const client = new RuntimeClient('https://localhost:8443', 'admin', 'pw', ax as any)
    const result = await client.pollCompilationStatus(100, 3000)
    expect(result.status).toBe('SUCCESS')
    expect(result.logs).toContain('done')
  })
})
