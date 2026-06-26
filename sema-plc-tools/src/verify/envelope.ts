import type { Envelope, EnvelopeStep } from './planTypes.js'

// 2000(sema 行宽) − ~30(缩进+键名) ≈ 1970,÷2(最坏转义膨胀:每 " 或 \ 变 2 字符) ≈ 985,取 900 留余量
const MAX_STR = 900
const MAX_ARRAY = 5
const MAX_LINES = 880
const MAX_STEPS = 100

// 深拷贝并施帽:数组 → 前 5 条 + 同级 `${key}TotalCount`;字符串 → MAX_STR 字符 + 标记。
export function capDetail(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…[depth capped]'
  if (typeof value === 'string') return value.length > MAX_STR ? value.slice(0, MAX_STR) + '…[truncated]' : value
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map(v => capDetail(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v) && v.length > MAX_ARRAY) out[`${k}TotalCount`] = v.length
      out[k] = capDetail(v, depth + 1)
    }
    return out
  }
  return value
}

export function renderEnvelope(env: Envelope): string {
  // steps 超过 MAX_STEPS 时截断,尾部追加标记步(skipped=true 表示非真实步)
  let steps: EnvelopeStep[] = env.steps
  if (steps.length > MAX_STEPS) {
    const n = steps.length
    const marker: EnvelopeStep = {
      name: `…[${n - MAX_STEPS} more steps omitted, see runDir/envelope.json]`,
      ok: true,
      ms: 0,
      skipped: true,
    }
    steps = [...steps.slice(0, MAX_STEPS), marker]
  }

  const capped: Envelope = {
    ...env,
    steps,
    ...(env.failure ? { failure: capDetail(env.failure) as Envelope['failure'] } : {}),
  }
  let text = JSON.stringify(capped, null, 2)
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) {
    // 信封超行数:detail 整体降级为摘要 + 指向落盘文件(LLM 去 runDir 看全量)
    const fallback: Envelope = {
      ...capped,
      failure: capped.failure ? { stage: capped.failure.stage, detail: '…[detail 过大,见 artifacts.runDir/envelope.json]', hints: capped.failure.hints } : undefined,
    }
    text = JSON.stringify(fallback, null, 2)
  }
  return text
}
