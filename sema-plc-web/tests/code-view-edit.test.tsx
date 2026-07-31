import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { useEditorStore } from '../src/store/editor'
import { useLangStore } from '../src/i18n'

const send = vi.fn()
vi.mock('../src/ws/useWsConnection', () => ({
  useWsConnection: () => ({ status: 'open', send }),
}))

import { CodeView } from '../src/components/center/CodeView'

beforeEach(() => {
  send.mockClear()
  useLangStore.getState().setLang('zh')
  useEditorStore.getState().clear()
  useEditorStore.getState().setFiles([{ path: 'a.st', mtime: 1 }, { path: 'b.st', mtime: 2 }])
  useEditorStore.getState().openFile('a.st', 'A')
})
// 断言失败会跳过测试体末尾的 cleanup(),残留 DOM 让后续测试报"找到多个元素"——统一在钩子里清
afterEach(cleanup)

describe('CodeView 编辑工具栏', () => {
  it('未脏时保存按钮禁用;输入后启用,点击发 editor:save', () => {
    render(<CodeView />)
    const saveBtn = screen.getByText('保存') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)

    act(() => { useEditorStore.getState().setStCode('A-edited') })
    expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByText('保存'))
    expect(send).toHaveBeenCalledWith({ type: 'editor:save', path: 'a.st', stCode: 'A-edited' })
    cleanup()
  })

  // 图签"修订"格:草稿 / 磁盘已变更 / 冲突(两者同时) 三态读数
  it('磁盘变更但无草稿 → 修订格显示"磁盘已变更"', () => {
    useEditorStore.getState().onDiskUpdate('B')
    render(<CodeView />)
    expect(screen.getByText(/磁盘已变更/)).toBeTruthy()
  })

  it('草稿 + 磁盘变更 → 修订格显示"冲突"', () => {
    useEditorStore.getState().setStCode('draft')
    useEditorStore.getState().onDiskUpdate('B')
    render(<CodeView />)
    expect(screen.getByText('冲突')).toBeTruthy()
  })

  it('无改动 → 修订格显示"已保存"', () => {
    render(<CodeView />)
    expect(screen.getByText('已保存')).toBeTruthy()
  })

  it('刷新丢弃草稿(本地应用 diskContent)', () => {
    useEditorStore.getState().setStCode('draft')
    useEditorStore.getState().onDiskUpdate('B')
    render(<CodeView />)
    fireEvent.click(screen.getByText('刷新'))
    expect(useEditorStore.getState().stCode).toBe('B')
    expect(useEditorStore.getState().isDirty).toBe(false)
    cleanup()
  })

  it('脏时切文件先确认:取消则不切', () => {
    useEditorStore.getState().setStCode('draft')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CodeView />)
    fireEvent.click(screen.getByText('b.st'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalledWith({ type: 'editor:open', path: 'b.st' })
    confirmSpy.mockRestore()
    cleanup()
  })

  // 面板隐藏(webview 被销毁)→ 草稿进 sessionStorage,重建后自动恢复
  it('visibilitychange hidden 暂存草稿,重新挂载恢复', () => {
    useEditorStore.getState().setStCode('draft')
    render(<CodeView />)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(sessionStorage.getItem('semaplc:draft')).toContain('draft')

    cleanup()
    useEditorStore.getState().openFile('a.st', 'A') // 重建:草稿丢了,磁盘内容未变
    render(<CodeView />)
    expect(useEditorStore.getState().stCode).toBe('draft')
    expect(sessionStorage.getItem('semaplc:draft')).toBe(null)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  // confirmDialog 是异步的(webview 下要等扩展回消息),web 下走 window.confirm 但仍隔一个微任务
  it('脏时切文件确认:确认则发 editor:open', async () => {
    useEditorStore.getState().setStCode('draft')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CodeView />)
    fireEvent.click(screen.getByText('b.st'))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'editor:open', path: 'b.st' }))
    confirmSpy.mockRestore()
    cleanup()
  })
})
