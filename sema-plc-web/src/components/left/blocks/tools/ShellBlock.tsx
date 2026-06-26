// src/components/left/blocks/tools/ShellBlock.tsx
import type { ToolCardData } from '../ToolCallCard'
import { ToolShell } from './ToolShell'
import { useT } from '../../../../i18n'

const MAX_LINES = 12

// 终端 \r 行为:回车到行首,后续覆盖。
function processTerminal(text: string): string[] {
  const out: string[] = []; let cur: string[] = []; let pos = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\r') { if (text[i + 1] === '\n') { out.push(cur.join('')); cur = []; pos = 0; i++ } else pos = 0 }
    else if (ch === '\n') { out.push(cur.join('')); cur = []; pos = 0 }
    else { cur[pos] = ch; pos++ }
  }
  if (cur.length) out.push(cur.join(''))
  return out
}

export function ShellBlock({ data }: { data: ToolCardData }) {
  const t = useT()
  const cmd = (data.input && typeof data.input === 'object') ? String((data.input as any).command ?? '') : ''
  const raw = data.streamText ?? data.result?.content ?? ''
  const lines = processTerminal(raw).filter((l) => l.trim() !== '')
  const omitted = lines.length > MAX_LINES ? lines.length - MAX_LINES : 0
  const shown = omitted ? lines.slice(-MAX_LINES) : lines
  return (
    <ToolShell data={data} label="Shell">
      {cmd && <div className="shell-cmd">$ {cmd}</div>}
      {omitted > 0 && <div className="shell-omitted">{t('tools.shell.omitted', { n: omitted })}</div>}
      {shown.length > 0 && <pre className="shell-out">{shown.join('\n')}</pre>}
    </ToolShell>
  )
}
