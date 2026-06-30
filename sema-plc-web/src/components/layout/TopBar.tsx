import { useState } from 'react'
import { useWorkspaceStore } from '../../store/workspace'
import { usePlcStore } from '../../store/plc'
import { useEditorStore } from '../../store/editor'
import { useModelStore } from '../../store/model'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT, useLang, setLang } from '../../i18n'

type Tone = 'ok' | 'idle' | 'warn' | 'err'
const TONE: Record<Tone, string> = { ok: 'var(--ok)', idle: 'var(--text-3)', warn: 'var(--warn)', err: 'var(--err)' }

function StatusDot({ tone, label, pulse }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span className="status-dot-wrap">
      <span className={'status-dot' + (pulse ? ' pulse' : '')} style={{ background: TONE[tone] }} />
      <span className="status-dot-label">{label}</span>
    </span>
  )
}

export function TopBar() {
  const t = useT()
  const lang = useLang()
  const workspace = useWorkspaceStore((s) => s.path)
  const switching = useWorkspaceStore((s) => s.switching)
  const status = usePlcStore((s) => s.status)
  const stProgram = useEditorStore((s) => s.stProgram)
  const stProgramPath = useEditorStore((s) => s.stProgramPath)
  const isDirty = useEditorStore((s) => s.isDirty)
  const currentPath = useEditorStore((s) => s.currentPath)
  const modelSelected = useModelStore((s) => s.selected)
  const modelActive = useModelStore((s) => s.active)
  const modelOptions = useModelStore((s) => s.options)
  const { send, status: wsStatus } = useWsConnection()
  const [editing, setEditing] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [vendorSel, setVendorSel] = useState<string | null>(null)
  // 自定义通道表单 state(不进 store;key 提交后清空)
  const [customBaseURL, setCustomBaseURL] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customAdapt, setCustomAdapt] = useState<'openai' | 'anthropic'>('openai')

  // 厂商分类:纯前端按 key 前缀/label 派生(后端 provider 字段是适配器类型,不是厂商)
  const vendorOf = (key: string): string => {
    if (key.startsWith('doubao')) return 'doubao'
    if (key.startsWith('minimax')) return 'minimax'
    if (key.startsWith('qwen') || key === 'dashscope') return 'qwen'
    if (key.startsWith('gemini')) return 'gemini'
    if (key.startsWith('groq')) return 'groq'
    // GLM 系:bigmodel / openai-compatible / glm-* / zai / siliconflow
    return 'glm'
  }
  const VENDOR_LABELS: Record<string, { zh: string; en: string }> = {
    doubao: { zh: '豆包', en: 'Doubao' },
    minimax: { zh: 'MiniMax', en: 'MiniMax' },
    qwen: { zh: '通义千问', en: 'Qwen' },
    glm: { zh: 'GLM 系', en: 'GLM' },
    groq: { zh: 'Groq', en: 'Groq' },
    gemini: { zh: 'Gemini', en: 'Gemini' },
  }

  const submitSwitch = () => {
    if (pathInput.trim()) send({ type: 'workspace:switch', path: pathInput.trim() })
    setEditing(false)
  }

  const running = status === 'RUNNING'
  // Derive the three semantic dots from real PLC + WS state.
  const run: [Tone, string, boolean] = running ? ['ok', t('topbar.status.running'), true] : ['idle', t('topbar.status.stopped'), false]
  const conn: [Tone, string, boolean] =
    wsStatus === 'open' ? ['ok', t('topbar.status.connected'), false]
    : wsStatus === 'connecting' ? ['warn', t('topbar.status.connecting'), true]
    : ['idle', t('topbar.status.disconnected'), false]
  const comp: [Tone, string, boolean] =
    status === 'ERROR' ? ['err', t('topbar.status.compileError'), false]
    : status === 'EMPTY' ? ['idle', t('topbar.status.notCompiled'), false]
    : ['ok', t('topbar.status.compiled'), false]
  const currentModelText = modelActive
    ? `${modelActive.key}:${modelActive.modelName}`
    : modelSelected ? `${modelSelected}: ${lang === 'zh' ? '未配置' : 'not configured'}`
    : (lang === 'zh' ? '未选择模型' : 'No model')

  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="logo-hex">
          <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
            <path d="M10 1 18.66 6 18.66 16 10 21 1.34 16 1.34 6Z" fill="none" stroke="var(--brand)" strokeWidth="1.6" />
            <circle cx="10" cy="11" r="3.1" fill="var(--brand)" />
          </svg>
        </span>
        <span className="tb-title">SemaPLC</span>
        {editing ? (
          <input
            autoFocus
            className="tb-path-input"
            value={pathInput}
            placeholder={workspace ?? ''}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSwitch()}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            className="tb-path"
            title={t('topbar.path.tooltip')}
            onDoubleClick={() => { setPathInput(workspace ?? ''); setEditing(true) }}
          >{switching ? t('topbar.path.switching') : (workspace ?? '—')}</span>
        )}
      </div>

      <div className="tb-right">
        <div className="lang-toggle" role="group" aria-label="Language">
          <button type="button" className={lang === 'zh' ? 'active' : ''} aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中</button>
          <button type="button" className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
        <div className="status-pill">
          <StatusDot tone={run[0]} label={run[1]} pulse={run[2]} />
          <span className="pill-sep" />
          <StatusDot tone={conn[0]} label={conn[1]} pulse={conn[2]} />
          <span className="pill-sep" />
          <StatusDot tone={comp[0]} label={comp[1]} pulse={comp[2]} />
        </div>
        <div className="tb-actions">
          <div className="model-menu">
            <button
              type="button"
              className="tb-btn icon model"
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
            </button>
            {modelOpen && (
              <div className="model-popover" role="dialog" aria-label={lang === 'zh' ? '模型设置' : 'Model settings'}>
                <div className="model-pop-head">
                  <div>
                    <div className="model-pop-title">{lang === 'zh' ? '模型设置' : 'Model Settings'}</div>
                    <div className="model-pop-sub">{currentModelText}</div>
                  </div>
                  <button type="button" className="model-pop-close" onClick={() => setModelOpen(false)} aria-label="Close">×</button>
                </div>
                <div className="model-list">
                  {modelOptions.length === 0 && <div className="model-empty">{lang === 'zh' ? '暂无已验证模型' : 'No verified models yet'}</div>}
                  {(() => {
                    // 按厂商分组,保持 modelOptions 原始顺序内的首次出现顺序
                    const order: string[] = []
                    const groups: Record<string, typeof modelOptions> = {}
                    for (const o of modelOptions) {
                      const v = vendorOf(o.key)
                      if (!groups[v]) { groups[v] = []; order.push(v) }
                      groups[v].push(o)
                    }
                    // 默认选中当前模型所属厂商(或第一个有可用模型的厂商)
                    const activeVendor = vendorSel && (vendorSel === 'custom' || groups[vendorSel])
                      ? vendorSel
                      : (modelSelected ? vendorOf(modelSelected) : order.find((v) => groups[v].some((o) => o.configured)) ?? order[0])
                    const vendorModels = groups[activeVendor] ?? []
                    // 自定义通道当前是否已配置(用于显示状态)
                    const customOpt = modelOptions.find((o) => o.key === 'custom')
                    const submitCustom = () => {
                      if (!customBaseURL.trim() || !customModelName.trim() || !customKey.trim()) return
                      if (!window.confirm(lang === 'zh' ? '保存并切换到自定义模型。后续 Agent 请求将使用该模型。继续吗？' : 'Save and switch to the custom model. Future Agent requests will use it. Continue?')) return
                      send({
                        type: 'model:custom-update',
                        baseURL: customBaseURL.trim(),
                        apiKey: customKey.trim(),
                        modelName: customModelName.trim(),
                        adapt: customAdapt,
                      })
                      setCustomKey('')
                      setModelOpen(false)
                    }
                    const renderModelRow = (opt: typeof modelOptions[number]) => {
                      const active = opt.key === modelSelected
                      const disabled = !opt.configured || wsStatus !== 'open' || active
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={'model-row' + (active ? ' active' : '') + (!opt.configured ? ' disabled' : '')}
                          disabled={disabled}
                          onClick={() => {
                            if (window.confirm(lang === 'zh' ? `切换到 ${opt.label}。后续 Agent 请求将使用该模型。继续吗？` : `Switch to ${opt.label}. Future Agent requests will use it. Continue?`)) {
                              send({ type: 'model:switch', key: opt.key })
                              setModelOpen(false)
                            }
                          }}
                        >
                          <span className="model-row-main">
                            <span className="model-row-title">{opt.label}</span>
                            <span className="model-row-sub">{opt.modelName}</span>
                          </span>
                          <span className={'model-row-badge ' + (active ? 'active' : opt.configured ? 'ok' : 'missing')}>
                            {active ? (lang === 'zh' ? '当前' : 'Current') : opt.configured ? (lang === 'zh' ? '可用' : 'Ready') : (lang === 'zh' ? '未配置' : 'No key')}
                          </span>
                        </button>
                      )
                    }
                    return (
                      <div className="model-cols">
                        <div className="model-vendors">
                          {order.map((v) => {
                            const list = groups[v]
                            const hasReady = list.some((o) => o.configured)
                            const isActiveVendor = v === activeVendor
                            const isCurrentVendor = modelSelected && vendorOf(modelSelected) === v
                            return (
                              <button
                                key={v}
                                type="button"
                                className={'model-vendor' + (isActiveVendor ? ' active' : '') + (!hasReady ? ' dim' : '')}
                                onClick={() => setVendorSel(v)}
                              >
                                <span className="model-vendor-name">{lang === 'zh' ? VENDOR_LABELS[v]?.zh : VENDOR_LABELS[v]?.en ?? v}</span>
                                <span className="model-vendor-count">{list.length}</span>
                                {isCurrentVendor && <span className="model-vendor-dot" />}
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            className={'model-vendor custom' + (activeVendor === 'custom' ? ' active' : '')}
                            onClick={() => setVendorSel('custom')}
                          >
                            <span className="model-vendor-name">{lang === 'zh' ? '⚙ 自定义' : '⚙ Custom'}</span>
                            {modelSelected === 'custom' && <span className="model-vendor-dot" />}
                          </button>
                        </div>
                        <div className="model-models">
                          {activeVendor === 'custom' ? (
                            <div className="model-custom-form">
                              <div className="model-field">
                                <label className="model-field-label">{lang === 'zh' ? '兼容格式' : 'Format'}</label>
                                <div className="model-adapt-toggle">
                                  <button type="button" className={customAdapt === 'openai' ? 'active' : ''} onClick={() => setCustomAdapt('openai')}>OpenAI</button>
                                  <button type="button" className={customAdapt === 'anthropic' ? 'active' : ''} onClick={() => setCustomAdapt('anthropic')}>Anthropic</button>
                                </div>
                              </div>
                              <div className="model-field">
                                <label className="model-field-label">{lang === 'zh' ? 'Base URL' : 'Base URL'}</label>
                                <input
                                  className="model-input"
                                  value={customBaseURL}
                                  onChange={(e) => setCustomBaseURL(e.target.value)}
                                  placeholder={customAdapt === 'openai' ? 'https://provider/v1' : 'https://provider (不带 /v1)'}
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
                                  placeholder={customOpt?.configured ? (lang === 'zh' ? '已设置(重新输入覆盖)' : 'Set (re-enter to overwrite)') : ''}
                                />
                              </div>
                              <button
                                type="button"
                                className="model-submit-btn"
                                disabled={wsStatus !== 'open' || !customBaseURL.trim() || !customModelName.trim() || !customKey.trim()}
                                onClick={submitCustom}
                              >
                                {lang === 'zh' ? '保存并切换' : 'Save & switch'}
                              </button>
                              {customOpt?.configured && (
                                <div className="model-custom-status">
                                  {lang === 'zh' ? `当前自定义: ${customOpt.modelName}` : `Current custom: ${customOpt.modelName}`}
                                </div>
                              )}
                              <div className="model-custom-hint">
                                {lang === 'zh'
                                  ? '提交后写入 .env 持久化,重启后保留。'
                                  : 'Persisted to .env on submit; survives restart.'}
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
          </div>
          <button
            className="tb-btn reset"
            disabled={switching || wsStatus !== 'open'}
            onClick={() => {
              if (window.confirm(t('topbar.reset.confirm'))) {
                send({ type: 'session:reset' })
              }
            }}
            title={t('topbar.reset.tooltip')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1a5 5 0 1 0 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6 0v2.5l2-1.25z" fill="currentColor"/>
            </svg>
            {t('topbar.reset')}
          </button>
          <button
            className="tb-btn run"
            disabled={!stProgram.trim() || wsStatus !== 'open'}
            onClick={() => send({ type: 'plc:run', stCode: stProgram })}
            title={
              running
                ? t('topbar.run.rerunTooltip')
                : stProgramPath
                  ? t('topbar.runFile', { path: stProgramPath }) + (currentPath === stProgramPath && isDirty ? ' — ' + t('topbar.run.unsavedHint') : '')
                  : t('topbar.run.noFileTooltip')
            }
          >
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true"><path d="M1 1l9 5-9 5z" fill="currentColor" /></svg>
            {running ? t('topbar.rerun') : t('topbar.run')}
          </button>
          <button
            className="tb-btn stop"
            disabled={!running || wsStatus !== 'open'}
            onClick={() => send({ type: 'plc:stop' })}
            title={t('topbar.stop.tooltip')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
            {t('topbar.stop')}
          </button>
        </div>
      </div>
    </header>
  )
}
