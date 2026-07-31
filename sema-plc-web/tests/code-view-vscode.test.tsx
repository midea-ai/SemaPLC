// CodeView 里两条「插件版 / web 版行为不同」的分支:
//  1. 点文件树:插件版额外让扩展在原生 tab 里打开(诊断/大纲/F12 全挂在 TextDocument 上),web 版一字不变;
//  2. 点自检:送检前剥 CONFIGURATION,回来的 stdlib 报错不进日志。
// acquireVsCodeApi 在 confirmDialog 里是模块级单例 → 每个用例 resetModules + 重新 import 隔离,
// 不能塞进 code-view-edit.test.tsx(那边的 window.confirm 用例会被这里装的 api 污染)。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const send = vi.fn()
vi.mock('../src/ws/useWsConnection', () => ({
  useWsConnection: () => ({ status: 'open', send }),
}))

const CONFIG_ST = `PROGRAM main
VAR x : BOOL; END_VAR
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM inst0 WITH task0 : main;
  END_RESOURCE
END_CONFIGURATION
`

/**
 * resetModules 之后 store 也得重新 import:CodeView 拿到的是新的模块实例,
 * 在测试文件顶层静态 import 的那份 store 跟它不是同一个,写进去组件读不到。
 */
async function mount() {
  const { CodeView } = await import('../src/components/center/CodeView')
  const { useEditorStore } = await import('../src/store/editor')
  const { useLogsStore } = await import('../src/store/logs')
  const { useLangStore } = await import('../src/i18n')
  useLangStore.getState().setLang('zh')
  useEditorStore.getState().setFiles([{ path: 'a.st', mtime: 1 }, { path: 'b.st', mtime: 2 }])
  useEditorStore.getState().openFile('a.st', CONFIG_ST)
  render(<CodeView />)
  return () => useLogsStore.getState().entries.map((l) => l.message)
}

/** 装上插件宿主注入的 acquireVsCodeApi,返回收集到的 postMessage */
function fakeWebview(): any[] {
  const posted: any[] = []
  ;(globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m) })
  return posted
}

/** 假 /api/check:记下实际送检的 stCode,回预设响应 */
function fakeCheck(res: any): string[] {
  const seen: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    seen.push(JSON.parse(init.body).stCode)
    return { json: async () => res } as any
  }))
  return seen
}

afterEach(() => {
  cleanup()
  send.mockClear()
  delete (globalThis as any).acquireVsCodeApi
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('CodeView 选文件', () => {
  it('插件版:除 editor:open 外,还让扩展在原生 tab 打开', async () => {
    const posted = fakeWebview()
    await mount()
    fireEvent.click(screen.getByText('b.st'))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'editor:open', path: 'b.st' }))
    expect(posted).toEqual([{ type: 'semaplc:open-file', path: 'b.st' }])
  })

  it('web 版:没有扩展可发,只走 editor:open', async () => {
    await mount()
    fireEvent.click(screen.getByText('b.st'))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'editor:open', path: 'b.st' }))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('再点当前文件:原生 tab 照开(用户可能刚把它关了),editor:open 才省掉', async () => {
    const posted = fakeWebview()
    await mount() // 打开的就是 a.st
    fireEvent.click(screen.getByTitle('a.st')) // 文件名在图签栏也出现一次,按 title 取树里那行
    await waitFor(() => expect(posted).toEqual([{ type: 'semaplc:open-file', path: 'a.st' }]))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('CodeView 自检', () => {
  it('送检前剥掉 CONFIGURATION 段(原样送 = 一串幽灵语法错)', async () => {
    const seen = fakeCheck({ ok: true, errors: [], outcome: 'passed' })
    await mount()
    fireEvent.click(screen.getByText('自检'))
    await waitFor(() => expect(seen.length).toBe(1))
    expect(seen[0]).not.toMatch(/CONFIGURATION/)
    expect(seen[0]).toContain('END_PROGRAM')
    // 等长空白替换:行数不变,报错的行号还能对回原文档
    expect(seen[0].split('\n').length).toBe(CONFIG_ST.split('\n').length)
  })

  // 三态渲染。过滤已经在 server 做完(见 tests/server/check-summary.test.ts),
  // 前端只负责把 outcome 翻成人话 —— 尤其 truncated 那支:它在真实容器上是常态,
  // 上一版按 ok 判断,这里必然渲染成红字「0 error(s)」。
  it('outcome=errors:逐条摊开', async () => {
    fakeCheck({
      ok: false, outcome: 'errors',
      errors: [
        { code: 'E007', file: '/tmp/plc-check-xk29d.st', line: 2, col: 5, message: 'real user error' },
        { code: 'E999', line: null, col: null, message: 'no file' },
      ],
    })
    const logs = await mount()
    fireEvent.click(screen.getByText('自检'))
    await waitFor(() => expect(logs().some((m) => m.includes('error(s)'))).toBe(true))
    expect(logs()).toContain('✗ plc_check: 2 error(s)')
    expect(logs().some((m) => m.includes('real user error'))).toBe(true)
    expect(logs().some((m) => m.includes('no file'))).toBe(true)
  })

  it('outcome=passed:一句通过', async () => {
    fakeCheck({ ok: true, errors: [], outcome: 'passed' })
    const logs = await mount()
    fireEvent.click(screen.getByText('自检'))
    await waitFor(() => expect(logs().length).toBe(2))
    expect(logs()[1]).toBe('✓ plc_check: rusty check passed')
  })

  it('outcome=truncated:ok=false 也不许报失败,且是 info 不是 error', async () => {
    const { useLogsStore } = await import('../src/store/logs')
    fakeCheck({ ok: false, errors: [], outcome: 'truncated' }) // 28 条全是 stdlib,exit 101
    const logs = await mount()
    fireEvent.click(screen.getByText('自检'))
    await waitFor(() => expect(logs().length).toBe(2))
    expect(logs()[1]).not.toMatch(/error\(s\)|✗/)
    expect(logs()[1]).toMatch(/exited early on stdlib/)
    expect(useLogsStore.getState().entries[1].level).toBe('info')
  })
})
