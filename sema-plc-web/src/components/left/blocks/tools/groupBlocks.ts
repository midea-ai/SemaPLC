// src/components/left/blocks/tools/groupBlocks.ts
import type { AgentBlock } from '../../../../../shared/protocol'
import { shortName } from '../ToolCallCard'

export type RenderItem =
  | { kind: 'block'; block: AgentBlock }
  | { kind: 'group'; id: string; blocks: AgentBlock[] }

const GROUPABLE = new Set(['view_file', 'search_files', 'search_content'])

function exploratoryShell(cmd: string): boolean {
  const stripCd = (s: string) => {
    const segs = s.split(/\s+&&\s+/).map((x) => x.trim()).filter(Boolean)
    let i = 0; while (i < segs.length - 1 && /^cd(?:\s|$)/.test(segs[i])) i++
    return segs.slice(i)
  }
  const ok = (seg: string) =>
    /^ls(?:\s|$)/.test(seg) || /^pwd(?:\s+-(?:L|P))*\s*$/.test(seg) ||
    (/^find(?:\s|$)/.test(seg) && !/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(seg))
  const segs = stripCd(cmd.trim())
  return segs.length > 0 && segs.every(ok)
}

function isGroupable(b: AgentBlock): boolean {
  if (b.kind !== 'tool') return false
  const sn = shortName(b.toolName)
  if (GROUPABLE.has(sn)) return true
  if (sn === 'run_shell') {
    const cmd = (b.input && typeof b.input === 'object') ? String((b.input as any).command ?? '') : ''
    return exploratoryShell(cmd)
  }
  return false
}

export function groupBlocks(blocks: AgentBlock[]): RenderItem[] {
  const items: RenderItem[] = []
  let run: AgentBlock[] = []
  const flush = () => {
    if (run.length === 0) return
    const hasRunning = run.some((b) => b.kind === 'tool' && b.status === 'running')
    if (run.length >= 2 && !hasRunning) {
      items.push({ kind: 'group', id: `group-${run[0].id}-${run[run.length - 1].id}`, blocks: run })
    } else {
      run.forEach((b) => items.push({ kind: 'block', block: b }))
    }
    run = []
  }
  for (const b of blocks) {
    if (isGroupable(b)) { run.push(b); continue }
    flush()
    items.push({ kind: 'block', block: b })
  }
  flush()
  return items
}
