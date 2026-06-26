// src/components/left/blocks/tools/TraceBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { parseResult, truncatedNote } from './parse'
import { useT } from '../../../../i18n'

export function TraceBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const p = parseResult(data.result)
  if (p.kind !== 'ok') return <ToolShell data={data} label={t('tools.trace.label')}><div className="tool-trunc-note">{p.kind === 'truncated' ? truncatedNote(p.rawBytes) : (p as any).text}</div></ToolShell>
  const d = p.data
  const columns: string[] = d.columns ?? []
  const meta: Record<string, { type?: string }> = d.meta ?? {}
  const samples: Array<{ elapsedMs: number; tick: number | null; values: any[] }> = d.samples ?? []
  return (
    <ToolShell data={data} label={t('tools.trace.label')} sub={t('tools.trace.sub', { n: samples.length })}>
      <div className="trace-scroll">
        <table className="var-table trace-table">
          <thead><tr><th>elapsedMs</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {samples.map((s, i) => (
              <tr key={i}><td>{s.elapsedMs}</td>{columns.map((c, j) => {
                const val = Array.isArray(s.values) ? s.values[j] : undefined
                const isBool = meta[c]?.type === 'BOOL'
                return <td key={c} className={isBool ? (val ? 'var-bool on' : 'var-bool off') : ''}>{val === undefined ? '—' : String(val)}</td>
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </ToolShell>
  )
}
