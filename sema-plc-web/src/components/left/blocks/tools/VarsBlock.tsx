// src/components/left/blocks/tools/VarsBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { parseResult, truncatedNote } from './parse'
import { useT } from '../../../../i18n'

function valChip(v: unknown, type: string) {
  if (type === 'BOOL') return <span className={'var-bool ' + (v ? 'on' : 'off')}>{String(v)}</span>
  return <span className="var-num">{String(v)}</span>
}

export function VarsBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const p = parseResult(data.result)
  if (p.kind !== 'ok') return <ToolShell data={data} label={t('tools.vars.label')}>{<div className="tool-trunc-note">{p.kind === 'truncated' ? truncatedNote(p.rawBytes) : (p as any).text}</div>}</ToolShell>
  const d = p.data
  const rows = Object.entries(d.variables ?? {}) as Array<[string, any]>
  return (
    <ToolShell data={data} label={t('tools.vars.label')} sub={d.tick != null ? `tick ${d.tick}` : undefined}>
      <table className="var-table">
        <thead><tr><th>{t('tools.col.var')}</th><th>{t('tools.col.value')}</th><th>{t('tools.col.type')}</th><th>{t('tools.col.location')}</th></tr></thead>
        <tbody>
          {rows.map(([name, info]) => (
            <tr key={name}><td>{name}</td><td>{valChip(info.value, info.type)}</td><td>{info.type}</td><td>{info.location || '—'}</td></tr>
          ))}
        </tbody>
      </table>
      {Array.isArray(d.unresolvedNames) && d.unresolvedNames.length > 0 && (
        <div className="var-unresolved">{t('tools.vars.unresolved', { names: d.unresolvedNames.join(', ') })}</div>
      )}
      {d.errorMessage && <div className="tool-trunc-note">{d.errorMessage}</div>}
    </ToolShell>
  )
}
