import { useState, type ReactNode } from 'react'
import { highlight } from '../../../lib/codeHighlight'
import type { ToolBlockResult } from '../../../../shared/protocol'
import { Caret } from './Caret'
import { useT } from '../../../i18n'

export interface ToolCardData {
  toolName: string
  input?: unknown
  streamText?: string
  result?: ToolBlockResult
  status: 'running' | 'success' | 'error'
}

export const shortName = (n: string) => n.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '').replace(/^mcp__.*__/, '')
const RESULT_CLAMP_LINES = 30

function JsonPre({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
  const isJsonLike = typeof value !== 'string' || /^[{[]/.test(text.trim())
  return (
    <pre className="tool-pre">
      {text.split('\n').map((l, i) => (<span key={i}>{isJsonLike ? highlight('json', l, i) : l}{'\n'}</span>))}
    </pre>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tool-sec">
      <button type="button" className="tool-sec-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Caret open={open} /> {label}</button>
      {open && children}
    </div>
  )
}

function ResultBody({ result }: { result: ToolBlockResult }) {
  const t = useT()
  const [full, setFull] = useState(false)
  const lines = result.content.split('\n')
  const clamped = !full && lines.length > RESULT_CLAMP_LINES
  const shown = clamped ? lines.slice(0, RESULT_CLAMP_LINES).join('\n') : result.content
  const truncNote = result.truncated ? t('tools.truncatedNoteInline', { kb: Math.round((result.rawBytes ?? 0) / 1024) }) : ''
  return (
    <div>
      <JsonPre value={shown} />
      {clamped && <button type="button" className="tool-expand" onClick={() => setFull(true)}>{t('tools.expandAll')}{truncNote}</button>}
      {!clamped && truncNote && <div className="tool-trunc-note">{truncNote}</div>}
    </div>
  )
}

function StatusIcon({ status }: { status: ToolCardData['status'] }) {
  const t = useT()
  if (status === 'running') return <span className="tool-spin" aria-label={t('tools.status.running')} />
  if (status === 'success') return <span className="tool-ok">✓</span>
  return <span className="tool-err">✗</span>
}

export function ToolCallCard({ data }: { data: ToolCardData }) {
  const t = useT()
  return (
    <div className={'tool-card st-' + data.status}>
      <div className="tool-head">
        <StatusIcon status={data.status} />
        <span className="tool-name">{shortName(data.toolName)}</span>
      </div>
      {data.input !== undefined && (
        <Section label={t('tools.section.params')}><JsonPre value={data.input} /></Section>
      )}
      {data.streamText && (
        <Section label={t('tools.section.outputStream')}><JsonPre value={data.streamText} /></Section>
      )}
      {data.result && data.result.content !== '' && (
        <Section label={t('tools.section.result')}><ResultBody result={data.result} /></Section>
      )}
    </div>
  )
}
