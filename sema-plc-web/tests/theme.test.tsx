import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readTheme, applyTheme } from '../src/theme'
import { useLangStore } from '../src/i18n'

vi.mock('../src/ws/useWsConnection', () => ({
  useWsConnection: () => ({ status: 'open', send: vi.fn() }),
}))
// ModelPanel 直接订阅 ws client(不走 hook),TopBar 一挂载就会取实例
vi.mock('../src/ws/client', () => ({
  getWsClient: () => ({ on: () => () => {}, send: vi.fn(), getStatus: () => 'open' }),
}))

beforeEach(() => {
  localStorage.clear()
  useLangStore.getState().setLang('zh')
  applyTheme('sheet')
})
afterEach(cleanup)

describe('主题', () => {
  it('默认 sheet;applyTheme 写 <html data-theme> 并存盘', () => {
    expect(readTheme()).toBe('sheet')
    applyTheme('modern')
    expect(document.documentElement.dataset.theme).toBe('modern')
    expect(readTheme()).toBe('modern')
  })

  it('非法/缺失值回落到 sheet', () => {
    localStorage.setItem('semaplc:theme', 'nope')
    expect(readTheme()).toBe('sheet')
  })

  it('顶栏按钮切换主题并持久化', async () => {
    const { TopBar } = await import('../src/components/layout/TopBar')
    render(<TopBar layout="split" onToggleLayout={() => {}} />)
    fireEvent.click(screen.getByTitle(/切换为现代配色/))
    expect(document.documentElement.dataset.theme).toBe('modern')
    fireEvent.click(screen.getByTitle(/切换为工程图纸配色/))
    expect(document.documentElement.dataset.theme).toBe('sheet')
    expect(localStorage.getItem('semaplc:theme')).toBe('sheet')
  })
})
