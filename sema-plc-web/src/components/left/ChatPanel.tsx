import { memo, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAgentStore, type ChatMessage } from '../../store/agent'
import { useModelStore } from '../../store/model'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT, useLang } from '../../i18n'
import { scenarios } from '../../i18n/scenarios'
import { PlanIndicator } from './PlanCard'
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
        {open ? '▾' : '▸'} {t('chat.group.toggle', { n: blocks.length })}
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

export function ChatPanel({ onCollapse }: { onCollapse?: () => void } = {}) {
  const t = useT()
  const lang = useLang()
  const messages = useAgentStore((s) => s.messages)
  const agentState = useAgentStore((s) => s.state)
  const todos = useAgentStore((s) => s.todos)
  const { send, status } = useWsConnection()
  const [input, setInput] = useState('')
  const [shown, setShown] = useState<number[]>(() => pickThree())
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const composingRef = useRef(false)
  const thinking = useModelStore((s) => s.thinking)
  const toggleThinking = () => send({ type: 'model:set-thinking', enabled: !thinking })
  useEffect(() => {
    // 收起时面板 clientHeight=0:跳过读 scrollHeight(强制布局)和滚动,避免对隐藏元素每 token 触发同步 reflow
    const el = scrollRef.current
    if (pinnedRef.current && el && el.clientHeight > 0) el.scrollTo({ top: el.scrollHeight })
  }, [messages])  // zustand 每次更新都换 messages 引用 → 每个 delta 触发

  const inputDisabled = status !== 'open'
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
          {onCollapse && (
            <button type="button" className="chat-collapse" onClick={onCollapse} title={t('chat.collapse')}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 8 8)" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="empty-chat">
          <div className="empty-agent-mark">
            <svg width="34" height="38" viewBox="0 0 20 22" aria-hidden="true">
              <path d="M10 1 18.66 6 18.66 16 10 21 1.34 16 1.34 6Z" fill="none" stroke="var(--brand)" strokeWidth="1.4" />
              <circle cx="10" cy="11" r="3.1" fill="var(--brand)" />
            </svg>
          </div>
          <p className="empty-title">{t('chat.empty.title')}</p>
          <p className="empty-sub">{t('chat.empty.sub')}</p>
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

      <div className="chat-input-wrap">
        <div className="chat-input-bar">
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
        </div>
        <div className="chat-input">
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
    </section>
  )
}
