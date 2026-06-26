import { create } from 'zustand'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'semaplc-lang'

function htmlLang(l: Lang): string {
  return l === 'zh' ? 'zh-CN' : 'en'
}

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    // localStorage 不可用（隐私模式）→ 回退默认
  }
  return 'zh'
}

interface LangState {
  lang: Lang
  setLang: (l: Lang) => void
}

export const useLangStore = create<LangState>((set) => ({
  lang: readInitial(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // 写失败静默忽略：仅丢失记忆，不影响本次切换
    }
    if (typeof document !== 'undefined') document.documentElement.lang = htmlLang(lang)
    set({ lang })
  },
}))

// 模块加载即同步 <html lang>，避免刷新后首帧停留在 index.html 写死值
if (typeof document !== 'undefined') {
  document.documentElement.lang = htmlLang(useLangStore.getState().lang)
}
