import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useEditorStore } from '../src/store/editor'
import { useLangStore } from '../src/i18n'

const send = vi.fn()
vi.mock('../src/ws/useWsConnection', () => ({
  useWsConnection: () => ({ status: 'open', send }),
}))

import { CodeView, buildTree, ancestorDirs } from '../src/components/center/CodeView'

beforeEach(() => {
  send.mockClear()
  useLangStore.getState().setLang('zh')
  useEditorStore.getState().clear()
  useEditorStore.getState().setFiles([
    { path: 'plan.json', mtime: 1 },
    { path: 'src/programs/escalator.st', mtime: 2 },
    { path: 'src/programs/conveyor.st', mtime: 3 },
    { path: 'config/scene.json', mtime: 4 },
  ])
})

describe('buildTree', () => {
  it('目录在前、同类按名排序', () => {
    const root = buildTree(['plan.json', 'src/b.st', 'config/a.json'])
    expect(root.children.map((c) => c.name)).toEqual(['config', 'src', 'plan.json'])
  })
  it('目录节点带累积路径', () => {
    const root = buildTree(['src/programs/a.st'])
    expect(root.children[0].path).toBe('src')
    expect(root.children[0].children[0].path).toBe('src/programs')
  })
  it('ancestorDirs 列出全部祖先目录', () => {
    expect(ancestorDirs('src/programs/a.st')).toEqual(['src', 'src/programs'])
    expect(ancestorDirs('a.st')).toEqual([])
  })
})

describe('CodeView 文件树折叠', () => {
  it('点目录折叠子项,再点展开', () => {
    render(<CodeView />)
    expect(screen.getByText('escalator.st')).toBeTruthy()

    fireEvent.click(screen.getByText('programs'))
    expect(screen.queryByText('escalator.st')).toBeNull()
    expect(screen.getByText('programs').closest('button')!.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByText('programs'))
    expect(screen.getByText('escalator.st')).toBeTruthy()
    cleanup()
  })

  it('折叠父目录后,打开其中文件会自动展开', () => {
    render(<CodeView />)
    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('escalator.st')).toBeNull()

    act(() => { useEditorStore.getState().openFile('src/programs/escalator.st', 'X') })
    expect(screen.getByText('escalator.st')).toBeTruthy()
    cleanup()
  })
})
