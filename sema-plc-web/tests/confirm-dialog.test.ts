// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

// acquireVsCodeApi 是模块级单例 → 每个用例用 resetModules + 重新 import 隔离
const load = async () => (await import('../src/lib/confirmDialog')).confirmDialog

afterEach(() => {
  delete (globalThis as any).acquireVsCodeApi
  vi.resetModules()
  vi.useRealTimers()
})

describe('confirmDialog', () => {
  it('web 版(无 acquireVsCodeApi)回退 window.confirm', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const confirmDialog = await load()
    await expect(confirmDialog('ok?')).resolves.toBe(true)
    expect(spy).toHaveBeenCalledWith('ok?')
    spy.mockRestore()
  })

  it('webview 版 postMessage 并按 id 配对 confirm-result', async () => {
    const posted: any[] = []
    ;(globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) })
    const confirmDialog = await load()
    const p1 = confirmDialog('a')
    const p2 = confirmDialog('b')
    expect(posted.map((m) => m.type)).toEqual(['semaplc:confirm', 'semaplc:confirm'])
    // 先回第二个,证明是按 id 配对而非按顺序
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'semaplc:confirm-result', id: posted[1].id, ok: true } }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'semaplc:confirm-result', id: posted[0].id, ok: false } }))
    await expect(p2).resolves.toBe(true)
    await expect(p1).resolves.toBe(false)
  })

  it('webview 版 60s 无回应视为取消', async () => {
    vi.useFakeTimers()
    ;(globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => {} })
    const confirmDialog = await load()
    const p = confirmDialog('x')
    vi.advanceTimersByTime(60_000)
    await expect(p).resolves.toBe(false)
  })
})
