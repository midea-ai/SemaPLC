import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'

const TMP_WS = path.join(os.tmpdir(), `plc-vis-save-test-${Date.now()}-${randomUUID()}`)

beforeEach(() => { fs.rmSync(TMP_WS, { recursive: true, force: true }) })
afterEach(() => { fs.rmSync(TMP_WS, { recursive: true, force: true }) })

vi.mock('sema-core', () => {
  class Emitter {
    listeners: Record<string, Array<(d: any) => void>> = {}
    on(e: string, cb: (d: any) => void) { (this.listeners[e] ??= []).push(cb); return this }
    once(e: string, cb: (d: any) => void) { const w = (d: any) => { cb(d); this.off(e, w) }; this.on(e, w); return this }
    off(e: string, cb: (d: any) => void) { this.listeners[e] = (this.listeners[e] ?? []).filter(f => f !== cb); return this }
    emit(e: string, d: any) { (this.listeners[e] ?? []).forEach(cb => cb(d)) }
  }
  class MockSession extends Emitter {
    sessionId = 'test-session-id'
    processUserInput() {}
    interrupt() {}
    respondToToolPermission() { return true }
    respondToPickOption() { return true }
    dispose() {}
  }
  class MockSemaCore extends Emitter {
    session = new MockSession()
    constructor(_c: any) { super() }
    async createSession() { return { ok: true, session: this.session } }
    async addModel() { return {} }
    async applyTaskModel() { return {} }
    async getRuleInfo() { return null }
    async getMemoryInfo() { return null }
    closeSession() { return true }
    async dispose() {}
  }
  return { SemaCore: MockSemaCore }
})

describe('internal:editor-save', () => {
  it('成功写盘后回 editor:saved 且带实际写盘 content', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const events: any[] = []
    const off = bus.on((m) => events.push(m))
    bus.emit({ type: 'internal:editor-save', path: 'src/programs/foo.st', stCode: 'PROGRAM p\nEND_PROGRAM' })
    await new Promise((r) => setTimeout(r, 50))

    const saved = events.find((e) => e.type === 'editor:saved')
    expect(saved).toBeTruthy()
    expect(saved.path).toBe('src/programs/foo.st')
    expect(saved.content).toBe('PROGRAM p\nEND_PROGRAM')
    expect(fs.readFileSync(path.join(TMP_WS, 'src/programs/foo.st'), 'utf8')).toBe('PROGRAM p\nEND_PROGRAM')

    off(); bus.removeAllListeners(); await bridge.dispose()
  })

  it('写盘失败回 error 且不发 editor:saved', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    // 在 workspace 下造一个目录,保存到同名路径 → writeFileSync 对目录抛 EISDIR
    fs.mkdirSync(path.join(TMP_WS, 'blocked'), { recursive: true })

    const events: any[] = []
    const off = bus.on((m) => events.push(m))
    bus.emit({ type: 'internal:editor-save', path: 'blocked', stCode: 'x' })
    await new Promise((r) => setTimeout(r, 50))

    expect(events.find((e) => e.type === 'editor:saved')).toBeFalsy()
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeTruthy()
    // 「保存失败」前缀只有 Step 4 的 try/catch 才有;裸 EISDIR 虽被 start() 的 catch-all
    // 兜住并发 error,但无此前缀 → 保证本用例实现前红、实现后绿(真 TDD,而非假绿)。
    expect(String(err.message)).toContain('保存失败')
    expect(String(err.message)).toContain('blocked')

    off(); bus.removeAllListeners(); await bridge.dispose()
  })

  it('拒绝越界路径:不写盘且回 error', async () => {
    const { SemaBridge } = await import('../../server/sema-bridge.js')
    const { bus } = await import('../../server/event-bus.js')
    const bridge = new SemaBridge(TMP_WS)
    await bridge.start()

    const events: any[] = []
    const off = bus.on((m) => events.push(m))
    bus.emit({ type: 'internal:editor-save', path: '../escape.st', stCode: 'x' })
    await new Promise((r) => setTimeout(r, 50))

    expect(events.find((e) => e.type === 'editor:saved')).toBeFalsy()
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeTruthy()
    expect(String(err.message)).toContain('outside workspace')
    // 没有任何文件被写到 workspace 外
    expect(fs.existsSync(path.join(path.dirname(TMP_WS), 'escape.st'))).toBe(false)

    off(); bus.removeAllListeners(); await bridge.dispose()
  })
})
