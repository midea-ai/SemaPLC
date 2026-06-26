import { useLangStore, type Lang } from './store'
import { dict, type TKey } from './dict'

export { useLangStore }
export type { Lang, TKey }

export const setLang = (l: Lang) => useLangStore.getState().setLang(l)
export const useLang = (): Lang => useLangStore((s) => s.lang)

type Params = Record<string, string | number>

export function translate(lang: Lang, key: TKey, params?: Params): string {
  let s: string = dict[lang][key] ?? dict.zh[key] ?? key
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]))
    }
  }
  return s
}

// 组件外用（纯函数等）：非响应式，读当前 store lang。
export function t(key: TKey, params?: Params): string {
  return translate(useLangStore.getState().lang, key, params)
}

// 组件内用：订阅 lang，切换语言时使用它的组件自动重渲染。
export function useT(): (key: TKey, params?: Params) => string {
  const lang = useLangStore((s) => s.lang)
  return (key, params) => translate(lang, key, params)
}
