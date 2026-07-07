import { useState, useEffect } from 'react'
import { getWsClient } from '../../ws/client'
import { useModelStore } from '../../store/model'
import { useWsConnection } from '../../ws/useWsConnection'
import { useLang } from '../../i18n'

const vendorOf = (key: string): string => {
  if (key.startsWith('doubao')) return 'doubao'
  if (key.startsWith('minimax')) return 'minimax'
  if (key.startsWith('qwen') || key === 'dashscope') return 'qwen'
  if (key.startsWith('gemini')) return 'gemini'
  if (key === 'deepseek' || key === 'deepseek-v4-pro') return 'deepseek'
  if (key === 'anthropic') return 'anthropic'
  if (key === 'openai' || key === 'gpt-5.5') return 'openai'
  if (key === 'xai') return 'xai'
  if (key === 'openrouter') return 'openrouter'
  if (key === 'kimi' || key === 'moonshot') return 'kimi'
  if (key === 'zai' || key === 'zhipu') return 'zai'
  if (key === 'bigmodel') return 'bigmodel'
  if (key === 'siliconflow') return 'siliconflow'
  return 'unknown'
}

const VENDOR_LABELS: Record<string, { zh: string; en: string }> = {
  deepseek: { zh: 'DeepSeek', en: 'DeepSeek' },
  anthropic: { zh: 'Anthropic', en: 'Anthropic' },
  openai: { zh: 'OpenAI', en: 'OpenAI' },
  xai: { zh: 'xAI', en: 'xAI' },
  minimax: { zh: 'MiniMax', en: 'MiniMax' },
  doubao: { zh: '豆包', en: 'Doubao' },
  qwen: { zh: '通义千问', en: 'Qwen' },
  bigmodel: { zh: 'BigModel', en: 'BigModel' },
  zai: { zh: 'zai', en: 'zai' },
  siliconflow: { zh: 'SiliconFlow', en: 'SiliconFlow' },
  openrouter: { zh: 'OpenRouter', en: 'OpenRouter' },
  kimi: { zh: 'Kimi', en: 'Kimi' },
  gemini: { zh: 'Gemini', en: 'Gemini' },
}

export function ModelPanel() {
  const lang = useLang()
  const modelSelected = useModelStore((s) => s.selected)
  const modelActive = useModelStore((s) => s.active)
  const modelOptions = useModelStore((s) => s.options)
  const thinking = useModelStore((s) => s.thinking)
  const { send, status: wsStatus } = useWsConnection()

  const [modelOpen, setModelOpen] = useState(false)
  const [vendorSel, setVendorSel] = useState<string | null>(null)
  const [customBaseURL, setCustomBaseURL] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customAdapt, setCustomAdapt] = useState<'openai' | 'anthropic'>('openai')
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [keyModalFor, setKeyModalFor] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyChecking, setKeyChecking] = useState(false)
  const [keyError, setKeyError] = useState<{ message?: string; curl?: string } | null>(null)
  const [curlCopied, setCurlCopied] = useState(false)
  const [savedVendorOrder, setSavedVendorOrder] = useState<string[] | null>(() => {
    try { return JSON.parse(localStorage.getItem('semaplc:vendor-order') ?? 'null') } catch { return null }
  })
  const [savedModelOrder, setSavedModelOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('semaplc:model-order') ?? '{}') ?? {} } catch { return {} }
  })
  const [dragVendor, setDragVendor] = useState<string | null>(null)
  const [dragOverVendor, setDragOverVendor] = useState<string | null>(null)
  const [dragModel, setDragModel] = useState<string | null>(null)
  const [dragOverModel, setDragOverModel] = useState<string | null>(null)

  const reorder = (list: string[], from: string, to: string): string[] | null => {
    const arr = [...list]
    const fi = arr.indexOf(from); const ti = arr.indexOf(to)
    if (fi < 0 || ti < 0 || fi === ti) return null
    arr.splice(fi, 1); arr.splice(ti, 0, from)
    return arr
  }
  const reorderVendors = (currentOrder: string[], from: string, to: string) => {
    const arr = reorder(currentOrder, from, to)
    if (!arr) return
    setSavedVendorOrder(arr)
    localStorage.setItem('semaplc:vendor-order', JSON.stringify(arr))
  }
  const reorderModels = (vendor: string, currentKeys: string[], fromKey: string, toKey: string) => {
    const arr = reorder(currentKeys, fromKey, toKey)
    if (!arr) return
    const next = { ...savedModelOrder, [vendor]: arr }
    setSavedModelOrder(next)
    localStorage.setItem('semaplc:model-order', JSON.stringify(next))
  }

  const sortByOrder = (order: string[]) => (a: string, b: string) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b)
    if (ia < 0 && ib < 0) return 0; if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib
  }

  const currentModelName = modelActive
    ? modelActive.modelName
    : modelSelected ? (lang === 'zh' ? '未配置' : 'no key')
    : (lang === 'zh' ? '未选择' : 'none')
  const currentModelText = modelActive
    ? `${modelActive.key}:${modelActive.modelName}`
    : modelSelected ? `${modelSelected}: ${lang === 'zh' ? '未配置' : 'not configured'}`
    : (lang === 'zh' ? '未选择模型' : 'No model')

  const keyModalOpt = keyModalFor ? modelOptions.find((o) => o.key === keyModalFor) : null
  const openKeyModal = (key: string) => {
    setKeyModalFor(key); setKeyInput(''); setKeyError(null); setKeyChecking(false); setCurlCopied(false)
  }
  const closeKeyModal = () => {
    setKeyModalFor(null); setKeyInput(''); setKeyError(null); setKeyChecking(false); setCurlCopied(false)
  }
  const submitKey = (force = false) => {
    if (!keyModalFor || !keyInput.trim() || keyChecking) return
    send({ type: 'model:set-key', key: keyModalFor, apiKey: keyInput.trim(), force })
    setKeyChecking(true); setKeyError(null); setCurlCopied(false)
  }

  useEffect(() => {
    const off = getWsClient().on((m) => {
      if (m.type !== 'model:key-result' || m.key !== keyModalFor) return
      setKeyChecking(false)
      if (m.ok) { closeKeyModal() }
      else { setKeyError({ message: m.message, curl: m.curl }); setCurlCopied(false) }
    })
    return off
  }, [keyModalFor])

  return (
    <div className="model-menu">
      <button
        type="button"
        className="tb-btn model-trigger"
        aria-haspopup="dialog"
        aria-expanded={modelOpen}
        onClick={() => setModelOpen((v) => !v)}
        title={lang === 'zh' ? `模型设置: ${currentModelText}` : `Model settings: ${currentModelText}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.09 1.65V21a2.1 2.1 0 0 1-4.2 0v-.07A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.09H2a2.1 2.1 0 0 1 0-4.2h.07A1.8 1.8 0 0 0 3.7 8.3a1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 0 1 2.97-2.97l.05.05a1.8 1.8 0 0 0 2 .36H8.4A1.8 1.8 0 0 0 9.5 2.07V2a2.1 2.1 0 0 1 4.2 0v.07a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 0 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2v.08A1.8 1.8 0 0 0 21.03 9.5H21a2.1 2.1 0 0 1 0 4.2h-.07A1.8 1.8 0 0 0 19.4 15Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="model-trigger-name">{currentModelName}</span>
      </button>
      {modelOpen && (
        <div className="model-popover" role="dialog" aria-label={lang === 'zh' ? '模型设置' : 'Model settings'}>
          <div className="model-pop-head">
            <div className="model-pop-headmain">
              <div className="model-pop-eyebrow">{lang === 'zh' ? '模型设置 · 当前' : 'Model · Active'}</div>
              <div className={'model-pop-current' + (modelActive ? '' : ' off')}>
                <span className="model-pop-led" />
                <span className="model-pop-current-name">{currentModelName}</span>
                {modelActive && <span className="model-pop-current-key">{modelActive.key}</span>}
                {thinking !== null && <span className="model-pop-thinking">{thinking ? (lang === 'zh' ? '💡 思考' : '💡 Thinking') : (lang === 'zh' ? '💡 关' : '💡 Off')}</span>}
              </div>
            </div>
            <button type="button" className="model-pop-close" onClick={() => setModelOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="model-list">
            {modelOptions.length === 0 && <div className="model-empty">{lang === 'zh' ? '暂无已验证模型' : 'No verified models yet'}</div>}
            {(() => {
              const customModels = modelOptions.filter((o) => o.key.startsWith('custom'))
              const rawOrder: string[] = []
              const groups: Record<string, typeof modelOptions> = {}
              for (const o of modelOptions) {
                if (o.key.startsWith('custom')) continue
                const v = vendorOf(o.key)
                if (!groups[v]) { groups[v] = []; rawOrder.push(v) }
                groups[v].push(o)
              }
              if (customModels.length > 0) rawOrder.push('custom')
              const order = savedVendorOrder
                ? [...rawOrder].sort(sortByOrder(savedVendorOrder))
                : rawOrder
              const selVendor = modelSelected ? (modelSelected.startsWith('custom') ? 'custom' : vendorOf(modelSelected)) : null
              const activeVendor = vendorSel && (vendorSel === 'custom' || vendorSel === 'custom-add' || order.includes(vendorSel))
                ? vendorSel
                : (selVendor ?? order.find((v) => v !== 'custom' && groups[v]?.some((o) => o.configured)) ?? order[0])
              const submitCustom = () => {
                if (!customBaseURL.trim() || !customModelName.trim() || !customKey.trim()) return
                send({
                  type: 'model:custom-add',
                  baseURL: customBaseURL.trim(),
                  apiKey: customKey.trim(),
                  modelName: customModelName.trim(),
                  adapt: customAdapt,
                })
                setCustomBaseURL(''); setCustomModelName(''); setCustomKey(''); setVendorSel('custom')
              }
              const vendorModelsSrc = groups[activeVendor] ?? []
              const smOrder = savedModelOrder[activeVendor]
              const cmpByOrder = smOrder ? sortByOrder(smOrder) : null
              const vendorModels = cmpByOrder
                ? [...vendorModelsSrc].sort((a, b) => cmpByOrder(a.key, b.key))
                : vendorModelsSrc
              const modelDragProps = (key: string) => ({
                draggable: wsStatus === 'open',
                onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move' as const; setDragModel(key) },
                onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverModel(key) },
                onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragModel) reorderModels(activeVendor, vendorModels.map((m) => m.key), dragModel, key); setDragModel(null); setDragOverModel(null) },
                onDragEnd: () => { setDragModel(null); setDragOverModel(null) },
                onDragLeave: () => setDragOverModel(null),
              })
              const dragCls = (key: string) => (dragModel === key ? ' dragging' : '') + (dragOverModel === key && dragModel !== key ? ' drag-over' : '')
              const renderModelRow = (opt: typeof modelOptions[number]) => {
                const active = opt.key === modelSelected
                if (!opt.configured) {
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={'model-row disabled needs-key' + dragCls(opt.key)}
                      disabled={wsStatus !== 'open'}
                      title={opt.envHint ? (lang === 'zh' ? `点击填入 ${opt.envHint}` : `Click to set ${opt.envHint}`) : undefined}
                      onClick={() => openKeyModal(opt.key)}
                      {...modelDragProps(opt.key)}
                    >
                      <span className="model-row-main">
                        <span className="model-row-title">{opt.modelName}</span>
                      </span>
                      <span className="model-row-badge missing">＋ {lang === 'zh' ? '填 key' : 'Add key'}{opt.envHint && <span className="model-row-env"> {opt.envHint}</span>}</span>
                    </button>
                  )
                }
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={'model-row' + (active ? ' active' : '') + dragCls(opt.key)}
                    disabled={wsStatus !== 'open'}
                    onClick={() => {
                      if (active) return
                      send({ type: 'model:switch', key: opt.key })
                      setModelOpen(false)
                    }}
                    {...modelDragProps(opt.key)}
                  >
                    <span className="model-row-main">
                      <span className="model-row-title">{opt.modelName}</span>
                    </span>
                    {active && (
                      <span className="model-row-badge active"><span className="model-row-led" />{lang === 'zh' ? '当前' : 'Active'}</span>
                    )}
                  </button>
                )
              }
              const csOrder = savedModelOrder['custom']
              const csCmp = csOrder ? sortByOrder(csOrder) : null
              const sortedCustom = csCmp
                ? [...customModels].sort((a, b) => csCmp(a.key, b.key))
                : customModels
              return (
                <div className="model-cols">
                  <div className="model-vendors">
                    {order.map((v) => {
                      const isCustom = v === 'custom'
                      const list = isCustom ? customModels : groups[v]
                      const hasReady = isCustom ? customModels.length > 0 : list.some((o) => o.configured)
                      const isActiveVendor = v === activeVendor
                      const isCurrentVendor = selVendor === v
                      const vendorDragProps = {
                        draggable: wsStatus === 'open',
                        onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move' as const; setDragVendor(v) },
                        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverVendor(v) },
                        onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragVendor) reorderVendors(order, dragVendor, v); setDragVendor(null); setDragOverVendor(null) },
                        onDragEnd: () => { setDragVendor(null); setDragOverVendor(null) },
                        onDragLeave: () => setDragOverVendor(null),
                      }
                      return (
                        <button
                          key={v}
                          type="button"
                          className={'model-vendor' + (isCustom ? ' custom' : '') + (isActiveVendor ? ' active' : '') + (!hasReady ? ' dim' : '') + (dragVendor === v ? ' dragging' : '') + (dragOverVendor === v && dragVendor !== v ? ' drag-over' : '')}
                          onClick={() => setVendorSel(v)}
                          {...vendorDragProps}
                        >
                          <span className="model-vendor-name">{isCustom ? (lang === 'zh' ? '⚙ 自定义' : '⚙ Custom') : ((lang === 'zh' ? VENDOR_LABELS[v]?.zh : VENDOR_LABELS[v]?.en) ?? v)}</span>
                          <span className="model-vendor-count">{list.length}</span>
                          {isCurrentVendor && <span className="model-vendor-dot" />}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className={'model-vendor custom-add' + (activeVendor === 'custom-add' ? ' active' : '')}
                      onClick={() => setVendorSel('custom-add')}
                    >
                      <span className="model-vendor-name">{lang === 'zh' ? '＋ 添加自定义' : '＋ Add custom'}</span>
                    </button>
                  </div>
                  <div className="model-models">
                    {activeVendor === 'custom' ? (
                      <div className="model-custom">
                        {customModels.length === 0 ? (
                          <div className="model-custom-empty">
                            {lang === 'zh' ? '暂无自定义模型,点左侧「＋ 添加自定义」新建。' : 'No custom models yet — use "＋ Add custom" on the left.'}
                          </div>
                        ) : sortedCustom.map((opt) => {
                          const active = opt.key === modelSelected
                          const confirming = confirmDelId === opt.key
                          return (
                            <div
                              key={opt.key}
                              draggable={wsStatus === 'open'}
                              className={'model-crow' + (active ? ' active' : '') + (dragModel === opt.key ? ' dragging' : '') + (dragOverModel === opt.key && dragModel !== opt.key ? ' drag-over' : '')}
                              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragModel(opt.key) }}
                              onDragOver={(e) => { e.preventDefault(); setDragOverModel(opt.key) }}
                              onDrop={(e) => { e.preventDefault(); if (dragModel) reorderModels('custom', sortedCustom.map((m) => m.key), dragModel, opt.key); setDragModel(null); setDragOverModel(null) }}
                              onDragEnd={() => { setDragModel(null); setDragOverModel(null) }}
                              onDragLeave={() => setDragOverModel(null)}
                            >
                              <button
                                type="button"
                                className="model-crow-hit"
                                disabled={active || wsStatus !== 'open'}
                                onClick={() => { send({ type: 'model:switch', key: opt.key }); setModelOpen(false) }}
                              >
                                <span className="model-row-main">
                                  <span className="model-row-title">{opt.label}</span>
                                  <span className="model-row-sub">{opt.modelName}</span>
                                </span>
                                {active && !confirming && <span className="model-row-badge active"><span className="model-row-led" />{lang === 'zh' ? '当前' : 'Active'}</span>}
                              </button>
                              {confirming ? (
                                <span className="model-del-confirm">
                                  <button type="button" className="model-del-yes" onClick={() => { send({ type: 'model:custom-delete', id: opt.key }); setConfirmDelId(null) }}>{lang === 'zh' ? '删除' : 'Delete'}</button>
                                  <button type="button" className="model-del-no" onClick={() => setConfirmDelId(null)}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
                                </span>
                              ) : (
                                <button type="button" className="model-del-btn" title={lang === 'zh' ? '删除' : 'Delete'} aria-label="Delete" onClick={() => setConfirmDelId(opt.key)}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : activeVendor === 'custom-add' ? (
                      <div className="model-custom">
                        <div className="model-custom-form">
                          <div className="model-field">
                            <label className="model-field-label">{lang === 'zh' ? '兼容格式' : 'Format'}</label>
                            <div className="model-adapt-toggle">
                              <button type="button" className={customAdapt === 'openai' ? 'active' : ''} onClick={() => setCustomAdapt('openai')}>OpenAI</button>
                              <button type="button" className={customAdapt === 'anthropic' ? 'active' : ''} onClick={() => setCustomAdapt('anthropic')}>Anthropic</button>
                            </div>
                          </div>
                          <div className="model-field">
                            <label className="model-field-label">Base URL</label>
                            <input
                              className="model-input"
                              value={customBaseURL}
                              onChange={(e) => setCustomBaseURL(e.target.value)}
                              placeholder={customAdapt === 'openai' ? 'https://provider/v1' : (lang === 'zh' ? 'https://provider (不带 /v1)' : 'https://provider (no /v1)')}
                              autoFocus
                            />
                          </div>
                          <div className="model-field">
                            <label className="model-field-label">{lang === 'zh' ? '模型名' : 'Model name'}</label>
                            <input
                              className="model-input"
                              value={customModelName}
                              onChange={(e) => setCustomModelName(e.target.value)}
                              placeholder="e.g. glm-5-turbo"
                            />
                          </div>
                          <div className="model-field">
                            <label className="model-field-label">{lang === 'zh' ? 'API Key' : 'API Key'}</label>
                            <input
                              className="model-input"
                              type="password"
                              value={customKey}
                              onChange={(e) => setCustomKey(e.target.value)}
                              placeholder="sk-…"
                            />
                          </div>
                          <div className="model-custom-actions">
                            <button
                              type="button"
                              className="model-submit-btn"
                              disabled={wsStatus !== 'open' || !customBaseURL.trim() || !customModelName.trim() || !customKey.trim()}
                              onClick={submitCustom}
                            >
                              {lang === 'zh' ? '添加并切换' : 'Add & switch'}
                            </button>
                            <button
                              type="button"
                              className="model-cancel-btn"
                              onClick={() => { setVendorSel('custom'); setCustomBaseURL(''); setCustomModelName(''); setCustomKey('') }}
                            >
                              {lang === 'zh' ? '取消' : 'Cancel'}
                            </button>
                          </div>
                          <div className="model-custom-hint">
                            {lang === 'zh' ? '保存到自定义列表,重启后保留。' : 'Saved to your custom list; persists across restart.'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      vendorModels.map(renderModelRow)
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
          <div className="model-pop-note">
            {lang === 'zh'
              ? '已验证模型 key 由 .env 管理;也可在「自定义」里填任意 OpenAI/Anthropic 兼容端点。'
              : 'Verified models use .env keys; or fill any OpenAI/Anthropic-compatible endpoint under Custom.'}
          </div>
        </div>
      )}
      {keyModalOpt && (
        <div className="model-key-overlay" onClick={closeKeyModal}>
          <div
            className="model-key-modal"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'zh' ? '填入 API Key' : 'Set API Key'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="model-key-head">
              <span className="model-key-title">{lang === 'zh' ? '填入 API Key' : 'Set API Key'}</span>
              <button type="button" className="model-pop-close" onClick={closeKeyModal} aria-label="Close">×</button>
            </div>
            <div className="model-key-sub">
              {(lang === 'en' ? (keyModalOpt.labelEn ?? keyModalOpt.label) : keyModalOpt.label)} · {keyModalOpt.modelName}
            </div>
            <div className="model-field">
              <label className="model-field-label">API Key{keyModalOpt.envHint ? ` · ${keyModalOpt.envHint}` : ''}</label>
              <input
                className="model-input"
                type="password"
                autoFocus
                disabled={keyChecking}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitKey(); else if (e.key === 'Escape') closeKeyModal() }}
                placeholder="sk-…"
              />
            </div>
            {keyError && (
              <div className="model-key-err">
                <div className="model-key-err-msg">{keyError.message || (lang === 'zh' ? '链路校验失败' : 'Connection test failed')}</div>
                {keyError.curl && (
                  <div className="model-key-curl">
                    <div className="model-key-curl-head">
                      <span>{lang === 'zh' ? 'curl 调试命令' : 'curl to debug'}</span>
                      <button
                        type="button"
                        className="model-key-curl-copy"
                        onClick={() => { navigator.clipboard?.writeText(keyError.curl ?? ''); setCurlCopied(true) }}
                      >
                        {curlCopied ? (lang === 'zh' ? '已复制' : 'Copied') : (lang === 'zh' ? '复制' : 'Copy')}
                      </button>
                    </div>
                    <pre className="model-key-curl-body">{keyError.curl}</pre>
                  </div>
                )}
                <button
                  type="button"
                  className="model-key-force"
                  disabled={wsStatus !== 'open' || !keyInput.trim() || keyChecking}
                  onClick={() => submitKey(true)}
                >
                  {lang === 'zh' ? '仍然保存(跳过校验)' : 'Save anyway (skip check)'}
                </button>
              </div>
            )}
            <div className="model-custom-actions">
              <button
                type="button"
                className="model-submit-btn"
                disabled={wsStatus !== 'open' || !keyInput.trim() || keyChecking}
                onClick={() => submitKey(false)}
              >
                {keyChecking ? (lang === 'zh' ? '校验中…' : 'Checking…') : (lang === 'zh' ? '保存' : 'Save')}
              </button>
              <button type="button" className="model-cancel-btn" onClick={closeKeyModal}>
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
            </div>
            <div className="model-custom-hint">
              {lang === 'zh'
                ? '保存前会发一个短请求校验链路;通过才写入 key-overrides.json(重启保留)。.env / shell 已设的同名 key 优先。'
                : 'A short probe checks the endpoint before saving; only on success is the key written to key-overrides.json (persists across restart). Existing .env/shell keys take precedence.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
