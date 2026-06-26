import { useState, type ReactNode } from 'react'
import type { ToolCardData } from '../ToolCallCard'
import { useT } from '../../../../i18n'

function StatusIcon({ status }: { status: ToolCardData['status'] }) {
  const t = useT()
  if (status === 'running') return <span className="tool-spin" aria-label={t('tools.status.running')} />
  if (status === 'success') return <span className="tool-ok">✓</span>
  return <span className="tool-err">✗</span>
}

/** 统一外壳:头部(状态 + 标签 + 折叠) + body。body 默认展开。 */
export function ToolShell(
  { data, label, sub, children, defaultOpen = true }:
  { data: ToolCardData; label: string; sub?: ReactNode; children: ReactNode; defaultOpen?: boolean },
) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={'tool-card st-' + data.status}>
      <button type="button" className="tool-head rich" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <StatusIcon status={data.status} />
        <span className="tool-name">{label}</span>
        {sub && <span className="tool-sub">{sub}</span>}
        <span className="tool-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="tool-rich-body">{children}</div>}
    </div>
  )
}
