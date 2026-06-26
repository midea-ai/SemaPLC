// src/components/left/blocks/tools/ReadBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { useT } from '../../../../i18n'

export function ReadBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const inp = (data.input && typeof data.input === 'object') ? (data.input as any) : {}
  const file = inp.file_path ? String(inp.file_path).split('/').pop() : ''
  return (
    <ToolShell data={data} label={t('tools.read.label')} sub={file} defaultOpen={false}>
      {data.result?.content && <pre className="read-content">{data.result.content}</pre>}
    </ToolShell>
  )
}
