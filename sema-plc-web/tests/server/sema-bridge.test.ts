import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'

const TMP_WS = path.join(os.tmpdir(), `plc-vis-bridge-test-${Date.now()}-${randomUUID()}`)

beforeEach(() => {
  fs.rmSync(TMP_WS, { recursive: true, force: true })
})
afterEach(() => {
  fs.rmSync(TMP_WS, { recursive: true, force: true })
})

// Mock sema-core (2.0.5: session-level API lives on the SemaSession returned by
// createSession(); the Core only does construct / addModel / createSession / dispose).
vi.mock('sema-core', () => {
  class Emitter {
    listeners: Record<string, Array<(d: any) => void>> = {}
    on(event: string, cb: (d: any) => void) { (this.listeners[event] ??= []).push(cb); return this }
    once(event: string, cb: (d: any) => void) { const w = (d: any) => { cb(d); this.off(event, w) }; this.on(event, w); return this }
    off(event: string, cb: (d: any) => void) { this.listeners[event] = (this.listeners[event] ?? []).filter(f => f !== cb); return this }
    emit(event: string, data: any) { (this.listeners[event] ?? []).forEach(cb => cb(data)) }
  }
  class MockSession extends Emitter {
    sessionId = 'test-session-id'
    processUserInput(_text: string) {}
    interrupt() {}
    respondToToolPermission() { return true }
    respondToPickOption() { return true }
    dispose() {}
  }
  class MockSemaCore extends Emitter {
    session = new MockSession()
    constructor(_config: any) { super() }
    async createSession() { return { ok: true, session: this.session } }
    async addModel() { return {} }
    async applyTaskModel() { return {} }
    // start() force-reloads these singleton caches after createSession (they are
    // cleared by dispose() but never reloaded by sema-core itself — see sema-bridge).
    async getRuleInfo(_refresh?: boolean) { return null }
    async getMemoryInfo(_refresh?: boolean) { return null }
    closeSession() { return true }
    async dispose() {}
  }
  return { SemaCore: MockSemaCore }
})

describe('SemaBridge', () => {
  it('emits workspace:ready + hydration on start()', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const events: any[] = []
    const off = bus.on((m) => events.push(m))

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const types = events.map(e => e.type)
    expect(types).toContain('workspace:ready')
    expect(types).toContain('plc:state')
    expect(types).toContain('plc:variables')
    expect(types).toContain('editor:files')

    off()
    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('emits editor:open if .st file exists', async () => {
    fs.mkdirSync(TMP_WS, { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'hello.st'), 'PROGRAM hello END_PROGRAM')

    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const events: any[] = []
    bus.on((m) => events.push(m))

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const opened = events.find(e => e.type === 'editor:open')
    expect(opened).toBeDefined()
    expect(opened.path).toBe('hello.st')
    expect(opened.content).toBe('PROGRAM hello END_PROGRAM')

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('handles internal:editor-save and emits editor:saved', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const events: any[] = []
    bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:editor-save', path: 'manual.st', stCode: 'PROGRAM manual END_PROGRAM' })

    // give async handler time
    await new Promise(r => setTimeout(r, 10))

    expect(fs.existsSync(path.join(TMP_WS, 'manual.st'))).toBe(true)
    expect(fs.readFileSync(path.join(TMP_WS, 'manual.st'), 'utf8')).toBe('PROGRAM manual END_PROGRAM')
    expect(events.some(e => e.type === 'editor:saved' && e.path === 'manual.st')).toBe(true)

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('emits editor:files + editor:open for a new .st file via the polling fallback (fs.watch unreliable)', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    // Drain hydration events
    const events: any[] = []
    bus.on((m) => events.push(m))

    // Simulate Agent writing a new ST file. fs.watch({recursive:true}) silently never
    // fires on this Node/macOS, so the 1s poll is what must surface the file.
    fs.writeFileSync(path.join(TMP_WS, 'heartbeat.st'), 'PROGRAM heartbeat END_PROGRAM')

    // Wait past the 1000ms poll interval + margin (NOT relying on fs.watch).
    await new Promise(r => setTimeout(r, 1300))

    const filesEvent = events.find(e => e.type === 'editor:files')
    const openEvent = events.find(e => e.type === 'editor:open')
    expect(filesEvent).toBeDefined()
    expect(filesEvent.files.some((f: any) => f.path === 'heartbeat.st')).toBe(true)
    expect(openEvent).toBeDefined()
    expect(openEvent.path).toBe('heartbeat.st')
    expect(openEvent.content).toBe('PROGRAM heartbeat END_PROGRAM')

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('emits editor:open the instant an Agent file-write tool completes (no waiting on fs.watch/poll)', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()
    const session = (bridge as any).session

    // Agent writes ST via its file tool, THEN the tool:execution:complete fires.
    fs.writeFileSync(path.join(TMP_WS, 'door.st'), 'PROGRAM door END_PROGRAM')
    const events: any[] = []
    bus.on((m) => events.push(m))
    session.emit('tool:execution:complete', { toolId: 't1', toolName: 'write_file', content: { ok: true } })

    // scheduleRescan debounce is 150ms — well under the 1s poll; assert it fired fast.
    await new Promise(r => setTimeout(r, 250))

    const openEvent = events.find(e => e.type === 'editor:open' && e.path === 'door.st')
    expect(openEvent).toBeDefined()
    expect(openEvent.content).toBe('PROGRAM door END_PROGRAM')

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('handles internal:editor-open by re-emitting editor:open with file content', async () => {
    fs.mkdirSync(TMP_WS, { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'a.st'), 'PROGRAM a END_PROGRAM')
    fs.writeFileSync(path.join(TMP_WS, 'b.st'), 'PROGRAM b END_PROGRAM')
    fs.utimesSync(path.join(TMP_WS, 'a.st'), 1, 1)  // make a.st older so b.st is newest

    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const events: any[] = []
    bus.on((m) => events.push(m))

    bus.emit({ type: 'internal:editor-open', path: 'a.st' })
    await new Promise(r => setTimeout(r, 20))

    const opened = events.find(e => e.type === 'editor:open' && e.path === 'a.st')
    expect(opened).toBeDefined()
    expect(opened.content).toBe('PROGRAM a END_PROGRAM')

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('mirrors state.json.stCode to src/programs/_running.st after plc_buildAndRun (Path B: inline stCode)', async () => {
    // Pre-seed state.json with a compiled stCode that has no .st file backing it
    fs.mkdirSync(path.join(TMP_WS, '.plc-vis'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, '.plc-vis', 'state.json'), JSON.stringify({
      lastCompile: {
        timestamp: '2026-05-21T00:00:00Z',
        stCode: 'PROGRAM inline_program END_PROGRAM',
        zipPath: '/tmp/x.zip',
        variableMap: [],
      },
    }))

    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    // 2.0.5: tool/agent events fire on the SemaSession, not the Core.
    const session = (bridge as any).session
    expect(session).toBeDefined()
    // Tool name uses real MCP format: 'mcp__<server>__<tool>'
    session.emit('tool:execution:complete', {
      toolId: 'tool-1',
      toolName: 'mcp__plc-tools__plc_buildAndRun',
      content: { success: true },
    })

    // Allow rescan + emit
    await new Promise(r => setTimeout(r, 300))

    expect(fs.existsSync(path.join(TMP_WS, 'src', 'programs', '_running.st'))).toBe(true)
    expect(fs.readFileSync(path.join(TMP_WS, 'src', 'programs', '_running.st'), 'utf8')).toBe('PROGRAM inline_program END_PROGRAM')

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('re-emits plc:variables after plc_buildAndRun completes (regression for stale Vars panel)', async () => {
    // Initial state.json: program A with variable foo
    fs.mkdirSync(path.join(TMP_WS, '.plc-vis'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, '.plc-vis', 'state.json'), JSON.stringify({
      lastCompile: {
        timestamp: '2026-05-21T00:00:00Z',
        stCode: 'PROGRAM A END_PROGRAM',
        zipPath: '/tmp/a.zip',
        variableMap: [{ index: 0, name: 'foo', type: 'BOOL', location: '%QX0.0' }],
      },
    }))

    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    // Drain hydration emits
    const events: any[] = []
    bus.on((m) => events.push(m))

    // Simulate a fresh compile: rewrite state.json with program B's variables
    fs.writeFileSync(path.join(TMP_WS, '.plc-vis', 'state.json'), JSON.stringify({
      lastCompile: {
        timestamp: '2026-05-21T00:00:05Z',
        stCode: 'PROGRAM B END_PROGRAM',
        zipPath: '/tmp/b.zip',
        variableMap: [
          { index: 0, name: 'bar', type: 'INT', location: '%QW0' },
          { index: 1, name: 'baz', type: 'BOOL', location: '%QX0.1' },
        ],
      },
    }))

    // Trigger Agent's tool-complete for plc_buildAndRun (real MCP name; 2.0.5: on session)
    const session = (bridge as any).session
    session.emit('tool:execution:complete', {
      toolId: 'tool-A',
      toolName: 'mcp__plc-tools__plc_buildAndRun',
      content: { success: true },
    })

    await new Promise(r => setTimeout(r, 300))

    const varEvents = events.filter(e => e.type === 'plc:variables')
    expect(varEvents.length).toBeGreaterThanOrEqual(1)
    const latest = varEvents[varEvents.length - 1]
    expect(latest.map.map((v: any) => v.name).sort()).toEqual(['bar', 'baz'])

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('detaches the previous internal-bus listener on workspace switch (regression)', async () => {
    const TMP_WS2 = path.join(os.tmpdir(), `plc-vis-bridge-test-2-${Date.now()}-${randomUUID()}`)

    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')

    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    // Trigger a workspace switch via the bus (the same path users would take)
    bus.emit({ type: 'internal:workspace-switch', path: TMP_WS2 })
    await new Promise(r => setTimeout(r, 30))

    // Now save a file; if the prior listener leaked, editor:saved fires twice
    const savedEvents: any[] = []
    bus.on((m) => { if (m.type === 'editor:saved') savedEvents.push(m) })
    bus.emit({ type: 'internal:editor-save', path: 'leak-check.st', stCode: 'X' })
    await new Promise(r => setTimeout(r, 20))

    expect(savedEvents).toHaveLength(1)

    bus.removeAllListeners()
    await bridge.dispose()
    fs.rmSync(TMP_WS2, { recursive: true, force: true })
  })

  it('per-turn plan: forwards only the current turn\'s todos (id > backend watermark frozen at idle→processing edge)', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()
    const session = (bridge as any).session

    const todoEvents: any[] = []
    bus.on((m) => { if (m.type === 'agent:todos') todoEvents.push(m.todos) })

    // Turn 1 starts (idle→processing): watermark frozen at 0 (nothing seen yet).
    session.emit('state:update', { state: 'processing' })
    session.emit('todos:update', [
      { id: '1', title: '探活', status: 'completed' },
      { id: '2', title: '生成+跑起来', status: 'in_progress' },
    ])
    expect(todoEvents.at(-1).map((t: any) => t.id)).toEqual(['1', '2'])  // both this-turn
    session.emit('state:update', { state: 'idle' })

    // Turn 2 starts: sema-core re-emits the FULL accumulated list (completed-first),
    // but the bridge freezes watermark at max-seen (2) and forwards only id > 2.
    session.emit('state:update', { state: 'processing' })
    session.emit('todos:update', [
      { id: '1', title: '探活', status: 'completed' },
      { id: '2', title: '生成+跑起来', status: 'completed' },
      { id: '3', title: '行为验证', status: 'in_progress' },
    ])
    expect(todoEvents.at(-1).map((t: any) => t.id)).toEqual(['3'])  // ONLY turn-2 todo

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('per-turn plan: a single turn keeps all its todos even as more are created (inject emits no state:update)', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()
    const session = (bridge as any).session

    const todoEvents: any[] = []
    bus.on((m) => { if (m.type === 'agent:todos') todoEvents.push(m.todos) })

    session.emit('state:update', { state: 'processing' })  // turn start, watermark=0
    session.emit('todos:update', [{ id: '1', title: 'a', status: 'completed' }])
    // more create_todo within the SAME turn — no new state:update fires
    session.emit('todos:update', [
      { id: '1', title: 'a', status: 'completed' },
      { id: '2', title: 'b', status: 'in_progress' },
      { id: '3', title: 'c', status: 'pending' },
    ])
    expect(todoEvents.at(-1).map((t: any) => t.id)).toEqual(['1', '2', '3'])  // all kept

    bus.removeAllListeners()
    await bridge.dispose()
  })

  it('after the open .st is deleted, falls back to the newest .st — never a config .json (Run-button regression)', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    fs.mkdirSync(path.join(TMP_WS, 'src', 'programs'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'src/programs/a.st'), 'PROGRAM a END_PROGRAM')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()                                  // opens a.st (only .st)
    // A second .st + a NEWER config json; then delete the currently-open a.st.
    // scanProjectFiles sorts mtime-desc, so scene_draft.json would be files[0].
    fs.mkdirSync(path.join(TMP_WS, 'config'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'src/programs/b.st'), 'PROGRAM b END_PROGRAM')
    fs.writeFileSync(path.join(TMP_WS, 'config/scene_draft.json'), '{"version":"1","canvas":{"width":800}}')
    fs.rmSync(path.join(TMP_WS, 'src/programs/a.st'))
    const events: any[] = []
    bus.on((m) => events.push(m))
    ;(bridge as any).rescanAndEmit({ openNewest: false })  // exercises the deleted-file fallback
    const opened = events.filter((e) => e.type === 'editor:open').pop()
    expect(opened).toBeDefined()
    expect(opened.path).toMatch(/\.st$/)                   // a real ST, NOT scene_draft.json
    expect(opened.path).not.toContain('scene_draft')
    bus.removeAllListeners()
    await bridge.dispose()
  })
})
