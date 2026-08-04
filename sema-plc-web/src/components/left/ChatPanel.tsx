import { memo, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAgentStore, type ChatMessage } from '../../store/agent'
import { useModelStore } from '../../store/model'
import { useEngineStore, retryEngine, configureModel } from '../../store/engine'
import { vscodeApi } from '../../lib/confirmDialog'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT, useLang } from '../../i18n'
import { scenarios } from '../../i18n/scenarios'
import { PlanIndicator } from './PlanCard'
import { Caret } from './blocks/Caret'
import { ThinkingBlock } from './blocks/ThinkingBlock'
import { ToolBlock } from './blocks/tools/ToolBlock'
import { groupBlocks } from './blocks/tools/groupBlocks'
import { MarkdownText } from './blocks/MarkdownText'
import type { AgentBlock } from '../../../shared/protocol'

// Pick 3 distinct random scenario indices. If `exclude` (the currently-shown set) is given,
// retry once so "换一个" yields a visibly different group.
export function pickThree(exclude?: number[]): number[] {
  const shuffle = () => {
    const idx = scenarios.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      // crypto RNG (not Math.random) — avoids the flagged insecure-randomness sink
      const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    return idx.slice(0, 3)
  }
  let pick = shuffle()
  if (exclude && exclude.length === 3 && pick.every((v) => exclude.includes(v))) pick = shuffle()
  return pick
}

// 封口的块引用不再变化 → memo 后只有活跃块随 token 重渲染
const BlockView = memo(function BlockView({ block }: { block: AgentBlock }) {
  if (block.kind === 'thinking') return <ThinkingBlock block={block} />
  if (block.kind === 'tool') return <ToolBlock data={block} />
  return (
    <div className="bubble-row agent">
      <div className="bubble agent md"><MarkdownText text={block.text} /></div>
    </div>
  )
})

function GroupCard({ blocks }: { blocks: AgentBlock[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="tool-group">
      <button type="button" className="tool-group-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Caret open={open} /> {t('chat.group.toggle', { n: blocks.length })}
      </button>
      {open && <div className="tool-group-body">{blocks.map((b) => <BlockView key={b.id} block={b} />)}</div>}
    </div>
  )
}

function Bubble({ m, onRetry, retryDisabled }: { m: ChatMessage; onRetry: () => void; retryDisabled: boolean }) {
  const t = useT()
  if (m.kind === 'user') return <div className="bubble-row user"><div className="bubble user">{m.text}</div></div>
  if (m.kind === 'error') return <div className="err-bubble">{m.text}</div>
  if (m.kind === 'manual-tool') {
    return <ToolBlock data={{ toolName: m.toolName, input: m.input, result: m.result, status: m.status }} />
  }
  // agent turn：按 blocks 顺序渲染
  return (
    <div className="turn">
      {groupBlocks(m.blocks).map((it) =>
        it.kind === 'group'
          ? <GroupCard key={it.id} blocks={it.blocks} />
          : <BlockView key={it.block.id} block={it.block} />,
      )}
      {m.status === 'error' && (
        <div className="turn-retry">
          <span>{t('chat.turn.error')}</span>
          <button type="button" disabled={retryDisabled} onClick={onRetry}>{t('common.retry')}</button>
        </div>
      )}
      {m.status === 'interrupted' && <div className="turn-note">{t('chat.turn.interrupted')}</div>}
    </div>
  )
}

export function shouldSubmitOnEnter(e: ReactKeyboardEvent<HTMLTextAreaElement>, isComposing: boolean): boolean {
  return e.key === 'Enter' && !e.shiftKey && !isComposing && !e.nativeEvent.isComposing && e.keyCode !== 229
}

// 宿主注入的插件版本(见 sema-plc-vscode/src/webview-host.ts)。浏览器里跑完整 web 应用时
// 没有这个 meta —— 空串,空态那行版本号自然不渲染。
const HOST_VERSION = document.querySelector('meta[name="semaplc-version"]')?.getAttribute('content') ?? ''

/**
 * 常驻状态条:环境不完整时说明「什么还不能用、去哪解决」。取代原先"激活时弹一次 toast"
 * —— 那条提示看完就没了,用户五分钟后去点运行还是不知道为什么失败。
 *
 * 两种态按严重程度排,一次只显示一条:
 *   没模型   对话整个不可用(输入框也禁着),最致命,优先报
 *   没引擎   还能写码/看梯形图,只是编译运行没了
 *
 * 「还没收到配置」必须和「收到了但没有」区分开,否则首帧会闪一条假警告:
 * options 为空 = model:config 还没到;engine 'unknown' = 还没探测(或浏览器版)。
 */
function StatusBar() {
  const t = useT()
  const engine = useEngineStore((s) => s.status)
  const active = useModelStore((s) => s.active)
  const options = useModelStore((s) => s.options)

  if (options.length > 0 && !active) {
    return (
      <div className="status-bar">
        <div className="status-bar-text">
          <strong>{t('model.none.title')}</strong>
          <span>{t('model.none.detail')}</span>
        </div>
        {/* 只有 VSCode 侧边栏需要这颗按钮:那边没有 TopBar 的 ModelPanel,没它就完全没有入口。
            浏览器版 vscodeApi() 为空,按钮不渲染 —— 那边去顶栏模型面板填。 */}
        {vscodeApi() && (
          <button type="button" className="status-bar-action" onClick={configureModel}>{t('model.none.action')}</button>
        )}
      </div>
    )
  }

  if (engine === 'none') {
    return (
      <div className="status-bar">
        <div className="status-bar-text">
          <strong>{t('engine.none.title')}</strong>
          <span>{t('engine.none.detail')}</span>
        </div>
        <button type="button" className="status-bar-action" onClick={retryEngine}>{t('engine.retry')}</button>
      </div>
    )
  }

  return null
}

export function ChatPanel({ onCollapse }: { onCollapse?: () => void } = {}) {
  const t = useT()
  const lang = useLang()
  const messages = useAgentStore((s) => s.messages)
  const agentState = useAgentStore((s) => s.state)
  const todos = useAgentStore((s) => s.todos)
  const usage = useAgentStore((s) => s.usage)
  const { send, status } = useWsConnection()
  const [input, setInput] = useState('')
  const [shown, setShown] = useState<number[]>(() => pickThree())
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const composingRef = useRef(false)
  const thinking = useModelStore((s) => s.thinking)
  const modelSelected = useModelStore((s) => s.selected)
  const modelOptions = useModelStore((s) => s.options)
  const modelActive = useModelStore((s) => s.active)
  const toggleThinking = () => send({ type: 'model:set-thinking', enabled: !thinking })
  useEffect(() => {
    // 收起时面板 clientHeight=0:跳过读 scrollHeight(强制布局)和滚动,避免对隐藏元素每 token 触发同步 reflow
    const el = scrollRef.current
    if (pinnedRef.current && el && el.clientHeight > 0) el.scrollTo({ top: el.scrollHeight })
  }, [messages])  // zustand 每次更新都换 messages 引用 → 每个 delta 触发

  // 没有可用模型时也要禁:server 侧已经挡住了(sema-bridge 的 modelReady),但让用户敲完
  // 一整段需求再收到"没发出去"是最差的顺序。options 为空 = 配置还没到,不算没模型。
  const noModel = modelOptions.length > 0 && !modelActive
  const wsDown = status !== 'open'
  const inputDisabled = wsDown || noModel
  const sendDisabled = inputDisabled || !input.trim() || agentState === 'processing'
  const submit = (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || inputDisabled) return
    send({ type: 'user:input', text: msg })
    setInput('')
  }

  const retry = () => {
    const lastUser = [...messages].reverse().find((m) => m.kind === 'user')
    if (lastUser && lastUser.kind === 'user') submit(lastUser.text)
  }

  const badge = agentState === 'processing'
    ? { cls: 'busy', text: t('chat.badge.processing') }
    : status === 'open' ? { cls: 'ok', text: t('chat.badge.ready') } : { cls: '', text: status === 'connecting' ? t('chat.badge.connecting') : t('chat.badge.offline') }

  return (
    <section className="chat-panel">
      <StatusBar />
      {/* 面板内标题栏只服务完整 web 应用(左栏要能折叠)。VSCode 侧边栏不传 onCollapse ——
          那边的标题栏是宿主原生的(视图名 + 新会话/设置),再画一条就成了两层标题。 */}
      {onCollapse && (
        <div className="chat-head">
          <span className="agent-avatar">
            <svg width="17" height="18" viewBox="0 0 20 22" aria-hidden="true">
              <path d="M10 1 18.66 6 18.66 16 10 21 1.34 16 1.34 6Z" fill="none" stroke="#fff" strokeWidth="1.6" />
              <circle cx="10" cy="11" r="3.1" fill="#fff" />
            </svg>
          </span>
          <div className="chat-head-text">
            <span className="chat-head-name">Agent</span>
            <span className={'chat-head-badge ' + badge.cls}>{badge.text}</span>
          </div>
          <div className="chat-head-right">
            <PlanIndicator processing={agentState === 'processing'} todos={todos} />
            <button type="button" className="chat-collapse" onClick={onCollapse} title={t('chat.collapse')}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 8 8)" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="empty-chat">
          <h1 className="empty-brand">SemaPLC</h1>
          {HOST_VERSION && <p className="empty-ver">sema-plc <span>v{HOST_VERSION}</span></p>}
          <p className="empty-sub">{t('chat.empty.tagline')}</p>
          <div className="empty-chips">
            {shown.map((i) => {
              const s = scenarios[i]
              return <button key={s.id} className="prompt-chip" disabled={inputDisabled} onClick={() => submit(s.prompt[lang])}>{s.title[lang]}</button>
            })}
            <button className="chip-shuffle" disabled={inputDisabled} onClick={() => setShown((cur) => pickThree(cur))} title={t('chat.shuffle.tooltip')}>
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {t('chat.shuffle')}
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="chat-stream"
          onScroll={(e) => {
            const el = e.currentTarget
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {messages.map((m) => (
            <Bubble key={m.id} m={m} onRetry={() => retry()} retryDisabled={agentState === 'processing'} />
          ))}
          {agentState === 'processing' && (
            <div className="bubble-row agent"><div className="bubble agent"><span className="typing"><span /><span /><span /></span></div></div>
          )}
        </div>
      )}

      <div className="composer-wrap">
        <div className="composer">
        {/* 顶行:待办进度 / 非就绪时的连接态 / 上下文用量。三者都没有时靠 :empty 收掉整行。 */}
        <div className="composer-top">
          {!onCollapse && <PlanIndicator processing={agentState === 'processing'} todos={todos} />}
          {status !== 'open' && <span className={'chat-head-badge ' + badge.cls}>{badge.text}</span>}
          {usage && usage.maxTokens > 0 && (() => {
            const pct = Math.min(100, Math.round((usage.useTokens / usage.maxTokens) * 100))
            const C = 2 * Math.PI * 5.5
            return (
              // tabIndex:悬停外也能用键盘 Tab 到这里看数据(浮层由 :focus-visible 一并触发)
              <span
                className={'ctx-usage' + (pct > 80 ? ' warn' : '')}
                tabIndex={0}
                aria-label={t('chat.ctx.tooltip', { used: usage.useTokens.toLocaleString(), max: usage.maxTokens.toLocaleString() })}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
                  <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 7 7)" />
                </svg>
                {pct}%
                <span className="ctx-pop" role="tooltip">
                  <span className="ctx-pop-title">{t('chat.ctx.pop.title')}</span>
                  <span className="ctx-pop-row">
                    <span>{t('chat.ctx.pop.used')}</span>
                    <b>{usage.useTokens.toLocaleString()}</b>
                  </span>
                  <span className="ctx-pop-row">
                    <span>{t('chat.ctx.pop.left')}</span>
                    <b>{Math.max(0, usage.maxTokens - usage.useTokens).toLocaleString()}</b>
                  </span>
                  <span className="ctx-pop-row muted">
                    <span>{t('chat.ctx.pop.max')}</span>
                    <b>{usage.maxTokens.toLocaleString()}</b>
                  </span>
                  <span className="ctx-pop-bar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="ctx-pop-hint">{t('chat.ctx.pop.hint')}</span>
                </span>
              </span>
            )
          })()}
        </div>
        <textarea
          rows={1}
          placeholder={status === 'open' ? (agentState === 'processing' ? t('chat.input.placeholder.processing') : t('chat.input.placeholder.ready')) : status === 'connecting' ? t('chat.input.placeholder.connecting') : t('chat.input.placeholder.offline')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => {
            setTimeout(() => { composingRef.current = false }, 0)
          }}
          onKeyDown={(e) => { if (shouldSubmitOnEnter(e, composingRef.current)) { e.preventDefault(); if (!sendDisabled) submit() } }}
          disabled={inputDisabled}
        />
        {/* 底行:模型 / 深度思考 / 发送。原生 <select> 而不是自绘弹层 —— 它自带键盘、
            滚动和窄栏下的定位,侧边栏只有 ~300px 宽,自绘的那套第一件事就是被截断。 */}
        <div className="composer-bar">
          {modelOptions.length > 0 && (
            <select
              className="model-select"
              value={modelSelected ?? ''}
              // 只看 WS,不看 noModel:没配 key 时切模型正是用户唯一该做的事,
              // 用 inputDisabled 禁掉等于把人锁死在一个用不了的模型上。
              disabled={wsDown}
              title={t('chat.model.tooltip')}
              aria-label={t('chat.model.tooltip')}
              onChange={(e) => send({ type: 'model:switch', key: e.target.value })}
            >
              {modelSelected === null && <option value="">—</option>}
              {modelOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {((lang === 'en' && o.labelEn) || o.label) + (o.configured ? '' : ` · ${t('chat.model.unconfigured')}`)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={'thinking-toggle' + (thinking ? ' on' : '')}
            onClick={toggleThinking}
            disabled={inputDisabled}
            title={thinking ? t('chat.thinking.on') : t('chat.thinking.off')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 1a5.5 5.5 0 0 0-2 10.63V13a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.37A5.5 5.5 0 0 0 8 1Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M6 15h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>{t('chat.thinking.label')}</span>
          </button>
          {agentState === 'processing' ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={() => send({ type: 'agent:interrupt' })}
              disabled={status !== 'open'}
              title={t('chat.stop.tooltip')}
              aria-label={t('chat.stop')}
            >
              {/* 两条竖线(暂停样式)— 处理中时取代发送箭头,点击发 agent:interrupt 中断当前 turn */}
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="1.2" fill="currentColor" /><rect x="9.5" y="3" width="3" height="10" rx="1.2" fill="currentColor" /></svg>
            </button>
          ) : (
            <button className="send-btn" onClick={() => submit()} disabled={sendDisabled} title={t('chat.send')} aria-label={t('chat.send')}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
        </div>
      </div>
    </section>
  )
}
