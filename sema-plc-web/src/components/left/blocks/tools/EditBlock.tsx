// src/components/left/blocks/tools/EditBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { isInputTruncated } from './parse'
import { useT } from '../../../../i18n'

export function EditBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const inp = (data.input && typeof data.input === 'object') ? (data.input as any) : {}
  const file = inp.file_path ? String(inp.file_path).split('/').pop() : ''
  const isNew = data.toolName.endsWith('write_file')
  // 主数据源 = result 带行号片段(不受 input 8KB 截断影响)
  const snippet = data.result?.content ?? ''
  // input 完整时额外给一条 search→replacement 摘要
  const showDiff = !isNew && !isInputTruncated(data.input) && inp.search_text != null
  return (
    <ToolShell data={data} label={isNew ? t('tools.edit.write') : t('tools.edit.edit')} sub={file}>
      {showDiff && (
        <div className="edit-diff">
          <pre className="edit-del">- {String(inp.search_text).split('\n')[0]}…</pre>
          <pre className="edit-add">+ {String(inp.replacement ?? '').split('\n')[0]}…</pre>
        </div>
      )}
      {snippet && <pre className="edit-snippet">{snippet}</pre>}
    </ToolShell>
  )
}
