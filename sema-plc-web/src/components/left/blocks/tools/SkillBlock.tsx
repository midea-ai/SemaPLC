// src/components/left/blocks/tools/SkillBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { useT } from '../../../../i18n'

export function SkillBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const inp = (data.input && typeof data.input === 'object') ? (data.input as any) : {}
  return (
    <ToolShell data={data} label={t('tools.skill.label')} sub={inp.skill} defaultOpen={false}>
      {inp.args && <div className="skill-args">{typeof inp.args === 'string' ? inp.args : JSON.stringify(inp.args)}</div>}
    </ToolShell>
  )
}
