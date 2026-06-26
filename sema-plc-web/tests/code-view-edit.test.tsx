import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
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

  it('diskChanged 时显示徽标', () => {
    useEditorStore.getState().setStCode('draft')
    useEditorStore.getState().onDiskUpdate('B')
    render(<CodeView />)
    expect(screen.getByText(/磁盘已变更/)).toBeTruthy()
    cleanup()
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

  it('脏时切文件确认:确认则发 editor:open', () => {
    useEditorStore.getState().setStCode('draft')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CodeView />)
    fireEvent.click(screen.getByText('b.st'))
    expect(send).toHaveBeenCalledWith({ type: 'editor:open', path: 'b.st' })
    confirmSpy.mockRestore()
    cleanup()
  })
})
