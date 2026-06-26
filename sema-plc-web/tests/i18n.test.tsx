import { describe, it, expect, beforeEach } from 'vitest'
import { useLangStore } from '../src/i18n/store'
import { dict } from '../src/i18n/dict'
import { translate, t, setLang } from '../src/i18n'
import { scenarios } from '../src/i18n/scenarios'

describe('lang store', () => {
  beforeEach(() => {
    localStorage.clear()
    useLangStore.setState({ lang: 'zh' })
  })

  it('setLang persists to localStorage and updates documentElement.lang', () => {
    useLangStore.getState().setLang('en')
    expect(useLangStore.getState().lang).toBe('en')
    expect(localStorage.getItem('semaplc-lang')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('setLang back to zh sets html lang zh-CN', () => {
    useLangStore.getState().setLang('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})

describe('dict integrity', () => {
  it('zh and en have identical key sets', () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.zh).sort())
  })
  it('no empty string values', () => {
    for (const lang of ['zh', 'en'] as const)
      for (const [k, v] of Object.entries(dict[lang]))
        expect(v, `${lang}.${k} is empty`).not.toBe('')
  })
})

describe('translate', () => {
  it('interpolates {name}', () => {
    expect(translate('en', 'topbar.runFile', { path: 'a.st' })).toBe('Compile + upload + run a.st')
  })
  it('keeps unmatched placeholder literal', () => {
    expect(translate('en', 'topbar.runFile')).toContain('{path}')
  })
  it('t() follows current store lang', () => {
    setLang('en')
    expect(t('topbar.run')).toBe('Run')
    setLang('zh')
    expect(t('topbar.run')).toBe('运行')
  })
})

describe('scenarios', () => {
  it('10 scenarios, each with non-empty zh/en title & prompt', () => {
    expect(scenarios).toHaveLength(10)
    for (const s of scenarios) {
      expect(s.id).toBeTruthy()
      expect(s.title.zh && s.title.en).toBeTruthy()
      expect(s.prompt.zh && s.prompt.en).toBeTruthy()
    }
  })
  it('scenario ids are unique', () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length)
  })
})
