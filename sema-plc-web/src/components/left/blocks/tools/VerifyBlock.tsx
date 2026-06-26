// src/components/left/blocks/tools/VerifyBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { parseResult, truncatedNote } from './parse'
import { useT } from '../../../../i18n'

export function VerifyBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const p = parseResult(data.result)
  if (p.kind !== 'ok') return <ToolShell data={data} label={t('tools.verify.label')}><div className="tool-trunc-note">{p.kind === 'truncated' ? truncatedNote(p.rawBytes) : (p as any).text}</div></ToolShell>
  const d = p.data
  const ex = d.expect ?? {}
  const passed = ex.matched === true && !ex.timedOut
  return (
    <ToolShell data={data} label={t('tools.verify.label')}>
      <div className={'verify-badge ' + (passed ? 'pass' : 'fail')}>{passed ? t('tools.verify.pass') : ex.timedOut ? t('tools.verify.timeout') : t('tools.verify.notMet')}</div>
      {d.verdict && <div className="verify-verdict">{d.verdict}</div>}
      <div className="verify-detail">
        {ex.finalValue !== undefined && <span>{t('tools.verify.finalValue', { value: String(ex.finalValue) })}</span>}
        {ex.elapsedMs !== undefined && <span>{ex.elapsedMs}ms</span>}
        {ex.polls !== undefined && <span>{t('tools.verify.polls', { n: ex.polls })}</span>}
      </div>
      {ex.errorMessage && <div className="tool-trunc-note">{ex.errorMessage}</div>}
    </ToolShell>
  )
}
