/**
 * 界面主题 —— 纯 CSS 变量皮肤,切换 = 改 <html data-theme>,组件不感知。
 * sheet(默认) 工程图纸 / modern 改版前的白底绿色配色。见 styles/semaplc.css :root。
 */
export type Theme = 'sheet' | 'modern'

const KEY = 'semaplc:theme'
export const THEMES: Theme[] = ['sheet', 'modern']

export function readTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'modern' ? 'modern' : 'sheet' } catch { return 'sheet' }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch {}
}

// 模块加载即套用:等到 React 首帧再设会闪一下旧主题
applyTheme(readTheme())
