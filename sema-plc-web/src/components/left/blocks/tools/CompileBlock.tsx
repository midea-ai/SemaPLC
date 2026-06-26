// src/components/left/blocks/tools/CompileBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { parseResult, truncatedNote } from './parse'
import { useT } from '../../../../i18n'

function srcName(input: unknown, inlineST: string): string {
  if (input && typeof input === 'object') {
    const o = input as any
    if (o.stPath) return String(o.stPath).split('/').pop() ?? ''
    if (o.stCode) return inlineST
  }
  return ''
}

export function CompileBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const p = parseResult(data.result)
  if (p.kind !== 'ok') return <ToolShell data={data} label={t('tools.compile.label')}><div className="tool-trunc-note">{p.kind === 'truncated' ? truncatedNote(p.rawBytes) : (p as any).text}</div></ToolShell>
  const d = p.data
  const c = d.compile ?? {}
  const iec = c.iec2c ?? {}
  const errors = iec.errors ?? []
  const warnings = iec.warnings ?? []
  const vmap = c.variableMap ?? []
  const ok = d.success === true
  return (
    <ToolShell data={data} label={t('tools.compile.label')} sub={srcName(data.input, t('tools.compile.srcInline'))} defaultOpen>
      {ok ? (
        <>
          <div className="compile-ok">{t('tools.compile.ok')}</div>
          {vmap.length > 0 && (
            <table className="var-table"><thead><tr><th>#</th><th>{t('tools.col.var')}</th><th>{t('tools.col.type')}</th><th>{t('tools.col.location')}</th></tr></thead>
              <tbody>{vmap.map((v: any) => <tr key={v.index}><td>{v.index}</td><td>{v.name}</td><td>{v.type}</td><td>{v.location || '—'}</td></tr>)}</tbody></table>
          )}
        </>
      ) : (
        <>
          <div className="compile-fail">{t('tools.compile.fail', { stage: d.failedStage })}{c.failedStage ? ` / ${c.failedStage}` : ''}</div>
          {c.errorSummary && <div className="compile-summary">{c.errorSummary}</div>}
          {errors.map((e: any, i: number) => (
            <div key={i} className="compile-err">
              <div className="compile-err-loc">{e.line}:{e.col} <span className="compile-err-msg">{e.message}</span></div>
              {e.sourceLine && <pre className="compile-src">{e.sourceLine}</pre>}
              {e.advice && <div className="compile-advice">💡 {e.advice}</div>}
            </div>
          ))}
        </>
      )}
      {warnings.length > 0 && <div className="compile-warns">{t('tools.compile.warns', { n: warnings.length, messages: warnings.map((w: any) => w.message).join('; ') })}</div>}
    </ToolShell>
  )
}
