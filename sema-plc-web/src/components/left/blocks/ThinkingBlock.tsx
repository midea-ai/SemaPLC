import { useState, useEffect } from 'react'
import type { AgentBlock } from '../../../../shared/protocol'
import { Caret } from './Caret'
import { useT } from '../../../i18n'

export function ThinkingBlock({ block }: { block: Extract<AgentBlock, { kind: 'thinking' }> }) {
  const t = useT()
  const [open, setOpen] = useState(block.streaming)
  // 流式结束自动收起(用户手动展开仍可,因为下面 effect 只在 streaming 变 false 时跑一次)
  useEffect(() => { if (!block.streaming) setOpen(false) }, [block.streaming])
  const title = block.streaming
    ? t('tools.thinking.inProgress')
    : t('tools.thinking.done', { sec: Math.max(1, Math.round((block.durationMs ?? 0) / 1000)) })
  return (
    <div className={'think-block' + (open ? ' open' : '')}>
      <button type="button" className="think-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={'think-dot' + (block.streaming ? ' pulse' : '')} />
        <span className="think-title">{title}</span>
        <Caret open={open} />
      </button>
      {open && <div className="think-body">{block.text}</div>}
    </div>
  )
}
