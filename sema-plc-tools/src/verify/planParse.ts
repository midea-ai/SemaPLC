import type { VerifyPlan, PlanCase, Expect, PlanError, Scalar, Op } from './planTypes.js'

// 字符级扫描剥注释:跟踪是否在字符串内(含转义),串外才剥 // 与 /* */;再去尾逗号。
export function stripJsonNoise(text: string): string {
  let out = '', i = 0, inStr = false
  while (i < text.length) {
    const c = text[i], n = text[i + 1]
    if (inStr) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === '"') inStr = false
      i++; continue
    }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  // 尾逗号:`,` 后(跳过空白)紧跟 } 或 ] 则删;循环至不动点处理嵌套
  let prev; do { prev = out; out = out.replace(/,\s*([}\]])/g, '$1') } while (out !== prev)
  return out
}

// ─── normalizeAndValidate ────────────────────────────────────────────────────

const OPS: Op[] = ['==', '!=', '>', '>=', '<', '<=']
const CASE_TYPES = ['steady', 'trace', 'record', 'sequence']
const KNOWN_FIELDS: Record<string, string[]> = {
  root: ['program', 'options', 'cases'],
  options: ['perCaseBudgetMs', 'stopAfter', 'failFast', 'skipBuild', 'serial'],
  steady: ['name', 'type', 'resetBefore', 'set', 'expect', 'expectations', 'settleMs', 'pulseScans', 'when'],
  trace: ['name', 'type', 'resetBefore', 'vars', 'durationMs', 'intervalMs', 'set', 'expectShape'],
  record: ['name', 'type', 'resetBefore', 'vars', 'lastScans', 'fromTick', 'expectShape'],
  sequence: ['name', 'type', 'resetBefore', 'steps'],
  step: ['set', 'pulseScans', 'settleMs', 'waitFor', 'expect'],
  expect: ['var', 'op', 'value', 'timeoutMs'],
  shape: ['var', 'kind', 'sequence', 'min', 'max', 'tailRatio'],
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...Array(n).fill(0)]
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

function suggest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const c of candidates) {
    const d = editDistance(word, c)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return bestDist <= 2 ? best : undefined
}

function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v
  if (v === 'true') return true
  if (v === 'false') return false
  const n = Number(v)
  if (!isNaN(n) && v.trim() !== '') return n
  return v
}

function normalizeExpectations(map: Record<string, unknown>): Expect[] {
  const result: Expect[] = []
  for (const [key, val] of Object.entries(map)) {
    const coerced = coerce(val) as Scalar
    if (key.endsWith('_min')) {
      result.push({ var: key.slice(0, -4), op: '>=', value: coerced })
    } else if (key.endsWith('_max')) {
      result.push({ var: key.slice(0, -4), op: '<=', value: coerced })
    } else {
      result.push({ var: key, op: '==', value: coerced })
    }
  }
  return result
}

function checkUnknownFields(obj: Record<string, unknown>, allowed: string[], path: string, errors: PlanError[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const s = suggest(key, allowed)
      errors.push({
        path: `${path}.${key}`,
        message: `未知字段 "${key}"`,
        suggestion: s ? `是不是想写 ${s}?示例见 plan-schema.md` : undefined,
      })
    }
  }
}

function validateExpectItem(item: unknown, path: string, errors: PlanError[]): Expect | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push({ path, message: 'expect 条目必须是对象' })
    return null
  }
  const obj = item as Record<string, unknown>
  checkUnknownFields(obj, KNOWN_FIELDS.expect, path, errors)

  let ok = true
  if (!obj.var || typeof obj.var !== 'string') {
    errors.push({ path: `${path}.var`, message: 'var 必须为非空字符串' }); ok = false
  }
  if (!OPS.includes(obj.op as Op)) {
    const s = suggest(String(obj.op ?? ''), OPS)
    errors.push({
      path: `${path}.op`,
      message: `op "${obj.op}" 不合法,合法值: ${OPS.join('/')}`,
      suggestion: s ? `是不是想写 ${s}?示例见 plan-schema.md` : undefined,
    }); ok = false
  }
  const coercedVal = coerce(obj.value)
  if (coercedVal === undefined || coercedVal === null || (typeof coercedVal !== 'number' && typeof coercedVal !== 'boolean' && typeof coercedVal !== 'string')) {
    errors.push({ path: `${path}.value`, message: 'value 必须为 number/boolean/string' }); ok = false
  }
  if (!ok) return null
  // timeoutMs 是 when/waitFor 的合法字段(KNOWN_FIELDS.expect 已收),必须透传——
  // 丢弃会让慢变条件 fallback 到 5s 默认而假超时(终审捕获的契约破口)。
  const timeoutMs = typeof obj.timeoutMs === 'number' && obj.timeoutMs > 0 ? { timeoutMs: obj.timeoutMs } : {}
  return { var: obj.var as string, op: obj.op as Op, value: coercedVal as Scalar, ...timeoutMs }
}

function validateSet(set: unknown, path: string, errors: PlanError[]): Record<string, Scalar> | null {
  if (!set || typeof set !== 'object' || Array.isArray(set)) {
    errors.push({ path, message: 'set 必须为非空对象' }); return null
  }
  const obj = set as Record<string, unknown>
  if (Object.keys(obj).length === 0) {
    errors.push({ path, message: 'set 不能为空对象' }); return null
  }
  const result: Record<string, Scalar> = {}
  for (const [k, v] of Object.entries(obj)) {
    result[k] = coerce(v) as Scalar
  }
  return result
}

function validateShapeItem(item: unknown, path: string, errors: PlanError[]): void {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push({ path, message: 'expectShape 条目必须是对象' }); return
  }
  const obj = item as Record<string, unknown>
  checkUnknownFields(obj, KNOWN_FIELDS.shape, path, errors)

  const SHAPE_KINDS = ['cycle', 'range', 'settle', 'changed']
  if (!SHAPE_KINDS.includes(obj.kind as string)) {
    const s = suggest(String(obj.kind ?? ''), SHAPE_KINDS)
    errors.push({
      path: `${path}.kind`,
      message: `kind "${obj.kind}" 不合法,合法值: cycle/range/settle/changed`,
      suggestion: s ? `是不是想写 ${s}?示例见 plan-schema.md` : undefined,
    })
    return // kind 不合法后续跳过
  }
  if (obj.kind === 'cycle') {
    if (!Array.isArray(obj.sequence) || obj.sequence.length < 2) {
      errors.push({ path: `${path}.sequence`, message: 'cycle 的 sequence 必须为 ≥2 个元素的数组' })
    } else if (new Set(obj.sequence.map(String)).size !== obj.sequence.length) {
      // 重复元素会让形状判定的 findIndex 永远命中首个,静默误判——在 parser 层拦下
      errors.push({ path: `${path}.sequence`, message: 'cycle 的 sequence 元素必须互不重复' })
    }
  }
  if (obj.kind === 'range' || obj.kind === 'settle') {
    const hasMin = obj.min !== undefined && typeof obj.min === 'number'
    const hasMax = obj.max !== undefined && typeof obj.max === 'number'
    if (!hasMin || !hasMax) {
      errors.push({ path, message: `${obj.kind} 的 min 和 max 必须都提供且为 number` })
    }
  }
  if (obj.tailRatio !== undefined) {
    const tr = obj.tailRatio as number
    if (typeof tr !== 'number' || tr <= 0 || tr >= 1) {
      errors.push({ path: `${path}.tailRatio`, message: 'tailRatio 必须在 (0,1) 区间内' })
    }
  }
}

export function normalizeAndValidate(raw: unknown): { plan: VerifyPlan | null; errors: PlanError[] } {
  const errors: PlanError[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { plan: null, errors: [{ path: '$', message: 'plan 必须为对象' }] }
  }
  const root = raw as Record<string, unknown>

  // root 白名单
  checkUnknownFields(root, KNOWN_FIELDS.root, '$', errors)

  // program
  if (!root.program || typeof root.program !== 'string' || !root.program.endsWith('.st')) {
    errors.push({ path: '$.program', message: 'program 必须为非空字符串且以 .st 结尾' })
  }

  // cases
  if (!Array.isArray(root.cases) || (root.cases as unknown[]).length === 0) {
    errors.push({ path: '$.cases', message: 'cases 必须为非空数组' })
    if (errors.length > 0 && !Array.isArray(root.cases)) {
      return { plan: null, errors }
    }
  }

  // options
  const DEFAULT_OPTIONS = { perCaseBudgetMs: 30_000, stopAfter: true, failFast: false, skipBuild: false, serial: false }
  let mergedOptions = { ...DEFAULT_OPTIONS }
  if (root.options !== undefined) {
    if (!root.options || typeof root.options !== 'object' || Array.isArray(root.options)) {
      errors.push({ path: '$.options', message: 'options 必须为对象' })
    } else {
      const opts = root.options as Record<string, unknown>
      checkUnknownFields(opts, KNOWN_FIELDS.options, '$.options', errors)
      for (const [k, v] of Object.entries(opts)) {
        if (k === 'perCaseBudgetMs') {
          if (typeof v !== 'number') errors.push({ path: `$.options.${k}`, message: `${k} 必须为 number` })
          else (mergedOptions as any)[k] = v
        } else if (['stopAfter', 'failFast', 'skipBuild', 'serial'].includes(k)) {
          if (typeof v !== 'boolean') errors.push({ path: `$.options.${k}`, message: `${k} 必须为 boolean` })
          else (mergedOptions as any)[k] = v
        }
      }
    }
  }

  // cases 逐条
  const normalizedCases: PlanCase[] = []
  const cases = Array.isArray(root.cases) ? (root.cases as unknown[]) : []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const cp = `cases[${i}]`
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      errors.push({ path: cp, message: 'case 必须为对象' }); continue
    }
    const cObj = c as Record<string, unknown>

    // name
    if (!cObj.name || typeof cObj.name !== 'string') {
      errors.push({ path: `${cp}.name`, message: 'name 必须为非空字符串' })
    }

    // type
    if (!CASE_TYPES.includes(cObj.type as string)) {
      const s = suggest(String(cObj.type ?? ''), CASE_TYPES)
      errors.push({
        path: `${cp}.type`,
        message: `type "${cObj.type}" 不合法,合法值: ${CASE_TYPES.join('/')}`,
        suggestion: s ? `是不是想写 ${s}?示例见 plan-schema.md` : undefined,
      })
      continue // type 不合法,跳过该 case 后续字段校验
    }

    const type = cObj.type as string
    const allowed = KNOWN_FIELDS[type] ?? []
    checkUnknownFields(cObj, allowed, cp, errors)

    if (type === 'steady') {
      // set
      let normalSet: Record<string, Scalar> | null = null
      if (cObj.set !== undefined) {
        normalSet = validateSet(cObj.set, `${cp}.set`, errors)
      } else {
        errors.push({ path: `${cp}.set`, message: 'steady case 必须提供 set' })
      }

      // expect / expectations
      let finalExpect: Expect[] | null = null

      // expectations map 兼容
      if (cObj.expectations !== undefined) {
        if (typeof cObj.expectations !== 'object' || Array.isArray(cObj.expectations)) {
          errors.push({ path: `${cp}.expectations`, message: 'expectations 必须为对象 map' })
        } else {
          const converted = normalizeExpectations(cObj.expectations as Record<string, unknown>)
          if (cObj.expect !== undefined) {
            errors.push({ path: `${cp}`, message: 'expect 与 expectations 不能同时提供——删掉 expectations,只用 expect 数组' })
          }
          finalExpect = converted
        }
      }

      // expect 显式数组(优先)
      if (cObj.expect !== undefined) {
        // map 形兼容:非数组 object 转换
        if (!Array.isArray(cObj.expect) && typeof cObj.expect === 'object' && cObj.expect !== null) {
          finalExpect = normalizeExpectations(cObj.expect as Record<string, unknown>)
        } else if (Array.isArray(cObj.expect)) {
          const validated: Expect[] = []
          for (let j = 0; j < (cObj.expect as unknown[]).length; j++) {
            const e = validateExpectItem((cObj.expect as unknown[])[j], `${cp}.expect[${j}]`, errors)
            if (e) validated.push(e)
          }
          finalExpect = validated
        } else {
          errors.push({ path: `${cp}.expect`, message: 'expect 必须为数组或对象 map' })
        }
      }

      if (!finalExpect || finalExpect.length === 0) {
        if (!errors.some(e => e.path.startsWith(`${cp}.expect`) || e.path === `${cp}`)) {
          errors.push({ path: `${cp}.expect`, message: 'steady case 必须提供非空 expect' })
        }
      }

      // settleMs
      if (cObj.settleMs !== undefined && (typeof cObj.settleMs !== 'number' || (cObj.settleMs as number) < 0)) {
        errors.push({ path: `${cp}.settleMs`, message: 'settleMs 必须为非负 number' })
      }

      // pulseScans
      if (cObj.pulseScans !== undefined) {
        const ps = cObj.pulseScans as number
        if (!Number.isInteger(ps) || ps < 1 || ps > 50) {
          errors.push({ path: `${cp}.pulseScans`, message: 'pulseScans 必须为 1..50 的整数' })
        }
      }

      // when
      let normalWhen: Expect | null = null
      if (cObj.when !== undefined) {
        normalWhen = validateExpectItem(cObj.when, `${cp}.when`, errors)
      }

      if (!errors.some(e => e.path.startsWith(cp))) {
        normalizedCases.push({
          name: cObj.name as string,
          type: 'steady',
          ...(cObj.resetBefore !== undefined ? { resetBefore: cObj.resetBefore as boolean } : {}),
          set: normalSet ?? {},
          expect: finalExpect ?? [],
          ...(cObj.settleMs !== undefined ? { settleMs: cObj.settleMs as number } : {}),
          ...(cObj.pulseScans !== undefined ? { pulseScans: cObj.pulseScans as number } : {}),
          ...(normalWhen !== null ? { when: normalWhen } : {}),
        } as PlanCase)
      }

    } else if (type === 'trace' || type === 'record') {
      // vars
      if (!Array.isArray(cObj.vars) || (cObj.vars as unknown[]).length === 0 || !(cObj.vars as unknown[]).every(v => typeof v === 'string')) {
        errors.push({ path: `${cp}.vars`, message: 'vars 必须为非空字符串数组' })
      }

      let traceNormalSet: Record<string, Scalar> | null = null
      if (type === 'trace') {
        if (typeof cObj.durationMs !== 'number' || (cObj.durationMs as number) <= 0) {
          errors.push({ path: `${cp}.durationMs`, message: 'durationMs 必须为 >0 的 number' })
        }
        if (cObj.set !== undefined) {
          traceNormalSet = validateSet(cObj.set, `${cp}.set`, errors)
        }
      }

      if (type === 'record') {
        if (cObj.lastScans !== undefined && (!Number.isInteger(cObj.lastScans) || (cObj.lastScans as number) <= 0)) {
          errors.push({ path: `${cp}.lastScans`, message: 'lastScans 必须为正整数' })
        }
        if (cObj.fromTick !== undefined && (!Number.isInteger(cObj.fromTick) || (cObj.fromTick as number) <= 0)) {
          errors.push({ path: `${cp}.fromTick`, message: 'fromTick 必须为正整数' })
        }
      }

      // expectShape 必须为非空数组
      if (!Array.isArray(cObj.expectShape) || (cObj.expectShape as unknown[]).length === 0) {
        errors.push({ path: `${cp}.expectShape`, message: 'expectShape 必须为非空数组' })
      } else {
        for (let k = 0; k < (cObj.expectShape as unknown[]).length; k++) {
          validateShapeItem((cObj.expectShape as unknown[])[k], `${cp}.expectShape[${k}]`, errors)
        }
      }

      if (!errors.some(e => e.path.startsWith(cp))) {
        normalizedCases.push({
          ...cObj,
          ...(traceNormalSet !== null ? { set: traceNormalSet } : {}),
        } as unknown as PlanCase)
      }

    } else if (type === 'sequence') {
      const normalizedSteps: Record<string, unknown>[] = []
      if (!Array.isArray(cObj.steps) || (cObj.steps as unknown[]).length === 0) {
        errors.push({ path: `${cp}.steps`, message: 'sequence case 必须提供非空 steps 数组' })
      } else {
        for (let j = 0; j < (cObj.steps as unknown[]).length; j++) {
          const step = (cObj.steps as unknown[])[j]
          const sp = `${cp}.steps[${j}]`
          if (!step || typeof step !== 'object' || Array.isArray(step)) {
            errors.push({ path: sp, message: 'step 必须为对象' }); continue
          }
          const sObj = step as Record<string, unknown>
          checkUnknownFields(sObj, KNOWN_FIELDS.step, sp, errors)
          if (!sObj.set && !sObj.waitFor && !sObj.expect) {
            errors.push({ path: sp, message: 'step 至少需要 set/waitFor/expect 之一' })
          }
          let stepNormalSet: Record<string, Scalar> | null = null
          if (sObj.set !== undefined) stepNormalSet = validateSet(sObj.set, `${sp}.set`, errors)
          let stepNormalWaitFor: Expect | null = null
          if (sObj.waitFor !== undefined) stepNormalWaitFor = validateExpectItem(sObj.waitFor, `${sp}.waitFor`, errors)
          const stepNormalExpect: Expect[] = []
          if (sObj.expect !== undefined && Array.isArray(sObj.expect)) {
            for (let k = 0; k < (sObj.expect as unknown[]).length; k++) {
              const e = validateExpectItem((sObj.expect as unknown[])[k], `${sp}.expect[${k}]`, errors)
              if (e) stepNormalExpect.push(e)
            }
          }
          if (sObj.pulseScans !== undefined) {
            const ps = sObj.pulseScans as number
            if (!Number.isInteger(ps) || ps < 1 || ps > 50) {
              errors.push({ path: `${sp}.pulseScans`, message: 'pulseScans 必须为 1..50 的整数' })
            }
          }
          if (sObj.settleMs !== undefined && (typeof sObj.settleMs !== 'number' || (sObj.settleMs as number) < 0)) {
            errors.push({ path: `${sp}.settleMs`, message: 'settleMs 必须为非负 number' })
          }
          normalizedSteps.push({
            ...sObj,
            ...(stepNormalSet !== null ? { set: stepNormalSet } : {}),
            ...(stepNormalWaitFor !== null ? { waitFor: stepNormalWaitFor } : {}),
            ...(sObj.expect !== undefined && Array.isArray(sObj.expect) ? { expect: stepNormalExpect } : {}),
          })
        }
      }

      if (!errors.some(e => e.path.startsWith(cp))) {
        normalizedCases.push({ ...cObj, steps: normalizedSteps } as unknown as PlanCase)
      }
    }
  }

  if (errors.length > 0) return { plan: null, errors }

  return {
    plan: {
      program: root.program as string,
      options: mergedOptions,
      cases: normalizedCases,
    },
    errors: [],
  }
}

// ─── parsePlanText ────────────────────────────────────────────────────────────

export function parsePlanText(text: string): { raw: any | null; errors: PlanError[] } {
  try {
    return { raw: JSON.parse(stripJsonNoise(text)), errors: [] }
  } catch (e) {
    return { raw: null, errors: [{ path: '$', message: `plan.json 不是合法 JSON(已尝试剥注释/尾逗号): ${e instanceof Error ? e.message : e}` }] }
  }
}
