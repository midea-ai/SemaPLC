import { describe, it, expect } from 'vitest'
import { renderEnvelope, capDetail } from '../../src/verify/envelope.js'

// 复刻 sema-code-core src/util/shell.ts 的 formatOutput 关键行为(行截断口径)
function semaFormatOutput(text: string): string {
  const lines = text.split('\n').map(l => l.length > 2000 ? l.slice(0, 2000) + '...[line truncated]' : l)
  if (lines.length <= 1000) return lines.join('\n')
  return [...lines.slice(0, 500), `... [${lines.length - 1000} lines truncated] ...`, ...lines.slice(-500)].join('\n')
}

const bigEnvelope = {
  ok: false, summary: 'x', stHash: 'sha256:abc', steps: [],
  failure: { stage: 'compile' as const, detail: { errors: Array.from({ length: 80 }, (_, i) => ({
    line: i, col: 1, message: 'M'.repeat(3000), severity: 'error', sourceLine: 'S'.repeat(2500), advice: 'A'.repeat(2200),
  })) } },
  cleanup: { released: [], releaseFailed: [], stopOk: true }, artifacts: { runDir: null },
}

describe('renderEnvelope (行宽安全)', () => {
  it('survives sema formatOutput round-trip as parseable JSON', () => {
    const out = renderEnvelope(bigEnvelope as any)
    const parsed = JSON.parse(semaFormatOutput(out))
    expect(parsed.ok).toBe(false)
    expect(parsed.failure.stage).toBe('compile')
  })
  it('caps every line under 1900 chars and total lines under 900', () => {
    const out = renderEnvelope(bigEnvelope as any)
    for (const l of out.split('\n')) expect(l.length).toBeLessThan(1900)
    expect(out.split('\n').length).toBeLessThan(900)
  })
})
describe('capDetail', () => {
  it('caps arrays to 5 items and records totalCount', () => {
    const d = capDetail({ errors: Array.from({ length: 30 }, (_, i) => ({ i })) }) as any
    expect(d.errors.length).toBe(5)
    expect(d.errorsTotalCount).toBe(30)
  })

  it('截断长字符串到 900 字符并附标记后缀', () => {
    const input = 'x'.repeat(2000)
    const result = capDetail(input) as string
    expect(result.length).toBe(900 + '…[truncated]'.length)
    expect(result.startsWith('x'.repeat(900))).toBe(true)
    expect(result.endsWith('…[truncated]')).toBe(true)
  })

  it('depth > 6 返回 depth capped 标记', () => {
    // 构造 8 层嵌套对象
    let nested: unknown = { v: 'leaf' }
    for (let i = 0; i < 8; i++) nested = { child: nested }
    const result = capDetail(nested) as any
    // 深入到第 7 层时 depth=7 > 6,返回 '…[depth capped]'
    let cur = result
    for (let i = 0; i < 6; i++) cur = cur.child
    expect(cur.child).toBe('…[depth capped]')
  })
})

describe('转义膨胀回归', () => {
  it('全引号/全反斜杠 detail 每行 <1900 且往返 parse 成功', () => {
    const env = {
      ok: false, summary: 'esc-test', stHash: null, steps: [],
      failure: {
        stage: 'compile' as const,
        detail: {
          sourceLine: '"'.repeat(2500),
          advice: '\\'.repeat(1200),
        },
      },
      cleanup: { released: [], releaseFailed: [], stopOk: true },
      artifacts: { runDir: null },
    }
    const out = renderEnvelope(env as any)
    for (const l of out.split('\n')) {
      expect(l.length).toBeLessThan(1900)
    }
    // 经 sema formatOutput 往返后仍是合法 JSON
    const parsed = JSON.parse(semaFormatOutput(out))
    expect(parsed.ok).toBe(false)
    expect(parsed.failure.stage).toBe('compile')
  })
})

describe('steps 帽回归', () => {
  it('500 个 steps 渲染后行数 <900、往返 parse、steps.length===101、末条含 omitted', () => {
    const env = {
      ok: true,
      summary: 'many-steps',
      stHash: null,
      steps: Array.from({ length: 500 }, (_, i) => ({ name: `step-${i}`, ok: true, ms: 1 })),
      cleanup: { released: [], releaseFailed: [], stopOk: true },
      artifacts: { runDir: null },
    }
    const out = renderEnvelope(env as any)
    expect(out.split('\n').length).toBeLessThan(900)
    const parsed = JSON.parse(semaFormatOutput(out))
    expect(parsed.steps.length).toBe(101)
    expect(parsed.steps[100].name).toContain('omitted')
  })
})
