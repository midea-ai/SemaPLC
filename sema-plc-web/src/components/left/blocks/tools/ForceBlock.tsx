// src/components/left/blocks/tools/ForceBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { parseResult, truncatedNote } from './parse'
import { useT } from '../../../../i18n'

function Group({ title, items, cls }: { title: string; items: any[]; cls?: string }) {
  if (!items?.length) return null
  return (
    <div className={'force-group ' + (cls ?? '')}>
      <div className="force-group-title">{title} ({items.length})</div>
      {items.map((it, i) => (
        <div key={i} className="force-row">
          <span className="force-name">{typeof it === 'string' ? it : it.name}</span>
          {typeof it !== 'string' && it.value !== undefined && <span className="force-val">{String(it.value)}</span>}
          {typeof it !== 'string' && it.type && <span className="force-type">{it.type}</span>}
        </div>
      ))}
    </div>
  )
}

export function ForceBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const p = parseResult(data.result)
  if (p.kind !== 'ok') return <ToolShell data={data} label={t('tools.force.label')}><div className="tool-trunc-note">{p.kind === 'truncated' ? truncatedNote(p.rawBytes) : (p as any).text}</div></ToolShell>
  const d = p.data
  return (
    <ToolShell data={data} label={t('tools.force.label')}>
      <Group title={t('tools.force.forced')} items={d.forced} />
      <Group title={t('tools.force.released')} items={d.released} />
      <Group title={t('tools.force.failed')} items={d.failed} cls="force-failed" />
      {d.errorMessage && <div className="tool-trunc-note">{d.errorMessage}</div>}
    </ToolShell>
  )
}
