import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock transitive deps that prevent module load
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() })),
}))
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
    })),
  },
}))

describe('PlcController', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits tool-start + tool-complete + log on plc-run success', async () => {
    const handleBuildAndRun = vi.fn().mockResolvedValue({ success: true, failedStage: null, finalStatus: 'RUNNING' })
    const handleStatus = vi.fn().mockResolvedValue({ status: 'STOPPED', isRunning: false, runtimeReachable: true })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')

    const ctrl = new PlcController({ workspace: '/tmp/x', _handleBuildAndRun: handleBuildAndRun, _handleStatus: handleStatus })
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:plc-run', stCode: 'PROGRAM x END_PROGRAM' })
    await new Promise(r => setTimeout(r, 30))

    expect(events.some(e => e.type === 'agent:tool-start' && e.name === 'plc_buildAndRun')).toBe(true)
    const done = events.find(e => e.type === 'agent:tool-complete' && e.name === 'plc_buildAndRun')
    expect(done).toBeDefined()
    expect(done.isError).toBe(false)
    expect(events.some(e => e.type === 'log' && e.source === 'tool')).toBe(true)

    off()
    bus.removeAllListeners()
  })

  it('plc-run while RUNNING: stops before buildAndRun (重新运行,规避换载竞态)', async () => {
    const order: string[] = []
    const handleStatus = vi.fn().mockResolvedValue({ status: 'RUNNING', isRunning: true, runtimeReachable: true })
    const handleStop = vi.fn(async () => { order.push('stop'); return { success: true, actualStatus: 'STOPPED', message: '' } })
    const handleBuildAndRun = vi.fn(async () => { order.push('build'); return { success: true, failedStage: null, finalStatus: 'RUNNING' } })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')
    const ctrl = new PlcController({ workspace: '/tmp/x', _handleStatus: handleStatus, _handleStop: handleStop, _handleBuildAndRun: handleBuildAndRun })
    const off = bus.on(() => {})

    bus.emit({ type: 'internal:plc-run', stCode: 'X' })
    await new Promise(r => setTimeout(r, 30))

    expect(handleStop).toHaveBeenCalled()
    expect(order).toEqual(['stop', 'build'])  // stop 必须先于 build

    off()
    bus.removeAllListeners()
  })

  it('plc-run while STOPPED: 不先 stop,直接 buildAndRun', async () => {
    const handleStatus = vi.fn().mockResolvedValue({ status: 'STOPPED', isRunning: false, runtimeReachable: true })
    const handleStop = vi.fn(async () => ({ success: true, actualStatus: 'STOPPED', message: '' }))
    const handleBuildAndRun = vi.fn().mockResolvedValue({ success: true, failedStage: null, finalStatus: 'RUNNING' })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')
    const ctrl = new PlcController({ workspace: '/tmp/x', _handleStatus: handleStatus, _handleStop: handleStop, _handleBuildAndRun: handleBuildAndRun })
    const off = bus.on(() => {})

    bus.emit({ type: 'internal:plc-run', stCode: 'X' })
    await new Promise(r => setTimeout(r, 30))

    expect(handleStop).not.toHaveBeenCalled()
    expect(handleBuildAndRun).toHaveBeenCalled()

    off()
    bus.removeAllListeners()
  })

  it('emits isError=true on plc-run failure', async () => {
    const handleBuildAndRun = vi.fn().mockResolvedValue({ success: false, failedStage: 'compile', finalStatus: null })
    const handleStatus = vi.fn().mockResolvedValue({ status: 'STOPPED', isRunning: false, runtimeReachable: true })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')

    const ctrl = new PlcController({ workspace: '/tmp/x', _handleBuildAndRun: handleBuildAndRun, _handleStatus: handleStatus })
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:plc-run', stCode: 'X' })
    await new Promise(r => setTimeout(r, 30))

    const done = events.find(e => e.type === 'agent:tool-complete' && e.name === 'plc_buildAndRun')
    expect(done.isError).toBe(true)
    expect(events.some(e => e.type === 'log' && e.level === 'error')).toBe(true)

    off()
    bus.removeAllListeners()
  })

  it('emits plc:runtime-error when fetchLogs returns runtimeErrors', async () => {
    const handleGetLogs = vi.fn().mockResolvedValue({
      logs: '',
      lineCount: 0,
      hasRuntimeErrors: true,
      runtimeErrors: [{ type: 'watchdog', message: 'wdt expired', advice: 'simplify' }],
      lastLine: '',
    })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')

    const ctrl = new PlcController({ workspace: '/tmp/x', _handleGetLogs: handleGetLogs })
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:plc-fetch-logs', lines: 10 })
    await new Promise(r => setTimeout(r, 30))

    expect(events.some(e => e.type === 'plc:runtime-error' && e.errors.length === 1)).toBe(true)

    off()
    bus.removeAllListeners()
  })

  it('handles internal:plc-force and emits plc:force-result', async () => {
    const handleForceVariables = vi.fn().mockResolvedValue({
      success: true,
      forced: [{ name: 'start_btn', value: true }],
      released: [],
      failed: [],
      errorMessage: null,
    })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')

    const ctrl = new PlcController({ workspace: '/tmp/x', _handleForceVariables: handleForceVariables })
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:plc-force', set: { start_btn: true } })
    await new Promise(r => setTimeout(r, 30))

    expect(handleForceVariables).toHaveBeenCalledWith({ set: { start_btn: true }, release: undefined }, expect.anything())
    const fr = events.find(e => e.type === 'plc:force-result')
    expect(fr).toBeDefined()
    expect(fr.forced).toEqual(['start_btn'])
    expect(events.some(e => e.type === 'agent:tool-start' && e.name === 'plc_forceVariables')).toBe(true)

    off()
    bus.removeAllListeners()
  })

  it('emits failure detail on plc-force failure', async () => {
    const handleForceVariables = vi.fn().mockResolvedValue({
      success: false,
      forced: [],
      released: [],
      failed: [{ name: 'nope', reason: 'variable not found in variableMap' }],
      errorMessage: null,
    })

    const { PlcController } = await import('../../server/plc-controller.js')
    const { bus } = await import('../../server/event-bus.js')

    const ctrl = new PlcController({ workspace: '/tmp/x', _handleForceVariables: handleForceVariables })
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:plc-force', set: { nope: 1 } })
    await new Promise(r => setTimeout(r, 30))

    const done = events.find(e => e.type === 'agent:tool-complete' && e.name === 'plc_forceVariables')
    expect(done.isError).toBe(true)
    expect(events.some(e => e.type === 'log' && e.level === 'error' && /nope/.test(e.message))).toBe(true)

    off()
    bus.removeAllListeners()
  })
})
