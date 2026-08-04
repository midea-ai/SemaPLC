import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock plc-tools imports so we don't need a running OpenPLC.
// We mock the transitive dependencies (socket.io-client, axios) to prevent
// module-load errors, and inject handleStatus/handleReadVariables via options.
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() })),
}))
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: {
        response: { use: vi.fn() },
        request: { use: vi.fn() },
      },
    })),
  },
}))

describe('PlcMonitor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts polling when first client connects', async () => {
    const handleStatus = vi.fn().mockResolvedValue({ status: 'STOPPED', isRunning: false, runtimeReachable: true })
    const handleReadVariables = vi.fn().mockResolvedValue({ success: true, variables: {}, unresolvedNames: [], errorMessage: null })

    const { PlcMonitor } = await import('../../server/plc-monitor.js')
    const m = new PlcMonitor({ workspace: '/tmp/x', intervalMs: 10, _handleStatus: handleStatus, _handleReadVariables: handleReadVariables })
    m.clientConnected()
    await new Promise(r => setTimeout(r, 25))
    expect(handleStatus).toHaveBeenCalled()
    m.stopPolling()
  })

  it('stops polling when last client disconnects', async () => {
    const handleStatus = vi.fn().mockResolvedValue({ status: 'STOPPED', isRunning: false, runtimeReachable: true })
    const handleReadVariables = vi.fn().mockResolvedValue({ success: true, variables: {}, unresolvedNames: [], errorMessage: null })

    const { PlcMonitor } = await import('../../server/plc-monitor.js')
    const m = new PlcMonitor({ workspace: '/tmp/x', intervalMs: 10, _handleStatus: handleStatus, _handleReadVariables: handleReadVariables })
    m.clientConnected()
    await new Promise(r => setTimeout(r, 25))
    const callsBefore = handleStatus.mock.calls.length
    m.clientDisconnected()
    await new Promise(r => setTimeout(r, 25))
    expect(handleStatus.mock.calls.length).toBe(callsBefore)
  })

  it('emits plc:state when status changes', async () => {
    const handleStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'STOPPED' })
      .mockResolvedValueOnce({ status: 'RUNNING' })
    const handleReadVariables = vi.fn().mockResolvedValue({ success: true, variables: {}, unresolvedNames: [], errorMessage: null })

    const { PlcMonitor } = await import('../../server/plc-monitor.js')
    const { bus } = await import('../../server/event-bus.js')
    const states: string[] = []
    const off = bus.on((m) => { if (m.type === 'plc:state') states.push(m.status) })

    const m = new PlcMonitor({ workspace: '/tmp/x', intervalMs: 10, _handleStatus: handleStatus, _handleReadVariables: handleReadVariables })
    m.clientConnected()
    await new Promise(r => setTimeout(r, 60))
    m.stopPolling()
    off()

    expect(states).toEqual(['STOPPED', 'RUNNING'])
  })

  // 去重键必须含 reachable:不可达时 status 也是 'ERROR',只比 status 的话
  // 「容器没起」→「容器起来了但编译错」不会 emit,消费端永远卡在第一种含义上。
  it('re-emits plc:state when reachability flips at an unchanged ERROR status', async () => {
    const handleStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'ERROR', isRunning: false, runtimeReachable: false })
      .mockResolvedValue({ status: 'ERROR', isRunning: false, runtimeReachable: true })
    const handleReadVariables = vi.fn().mockResolvedValue({ success: true, variables: {}, unresolvedNames: [], errorMessage: null })

    const { PlcMonitor } = await import('../../server/plc-monitor.js')
    const { bus } = await import('../../server/event-bus.js')
    const states: Array<{ status: string; reachable?: boolean }> = []
    const off = bus.on((m) => { if (m.type === 'plc:state') states.push({ status: m.status, reachable: m.reachable }) })

    const m = new PlcMonitor({ workspace: '/tmp/x', intervalMs: 10, _handleStatus: handleStatus, _handleReadVariables: handleReadVariables })
    m.clientConnected()
    await new Promise(r => setTimeout(r, 60))
    m.stopPolling()
    off()

    expect(states).toEqual([
      { status: 'ERROR', reachable: false },
      { status: 'ERROR', reachable: true },
    ])
  })
})
