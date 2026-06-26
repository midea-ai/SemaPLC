import type { Scalar, ShapeExpect } from './planTypes.js'

export interface ShapeVerdict { ok: boolean; reason: string; observed?: Scalar[] }

export function judgeShape(samples: Array<Scalar | null>, shape: ShapeExpect): ShapeVerdict {
  const nonNull = samples.filter((s): s is Scalar => s !== null)
  switch (shape.kind) {
    case 'changed': {
      const distinct = new Set(nonNull.map(String))
      return distinct.size >= 2
        ? { ok: true, reason: `${shape.var} 有变化(${distinct.size} 个取值)` }
        : { ok: false, reason: `${shape.var} 全程死值(${nonNull[0] ?? '无样本'})——疑似无 plant 自驱或程序未消费输入` }
    }
    case 'range': {
      const nums = nonNull.map(Number).filter(Number.isFinite)
      // 无有效数值时不许虚假通过(变量名错/采集故障的样本全是 null/非数值)
      if (nums.length === 0) return { ok: false, reason: `${shape.var} 无有效数值样本,无法判定区间` }
      const out = nums.find(n => n < shape.min! || n > shape.max!)
      return out === undefined
        ? { ok: true, reason: `${shape.var} 全程在 [${shape.min},${shape.max}]` }
        : { ok: false, reason: `${shape.var} 越界:观测到 ${out},期望 [${shape.min},${shape.max}]` }
    }
    case 'settle': {
      const ratio = shape.tailRatio ?? 0.25
      const nums = nonNull.map(Number).filter(Number.isFinite)
      const tail = nums.slice(Math.max(0, Math.floor(nums.length * (1 - ratio))))
      if (tail.length === 0) return { ok: false, reason: `${shape.var} 无可判稳态样本` }
      const out = tail.find(n => n < shape.min! || n > shape.max!)
      return out === undefined
        ? { ok: true, reason: `${shape.var} 末段稳定在 [${shape.min},${shape.max}]` }
        : { ok: false, reason: `${shape.var} 末段未收敛:观测到 ${out},期望稳态 [${shape.min},${shape.max}](末值 ${nums[nums.length - 1]})` }
    }
    case 'cycle': {
      // 折叠连续重复 → 状态序列;每个相邻转移必须是 sequence 中的"下一个"(循环),入口可在环中任意点。
      const collapsed: Scalar[] = []
      for (const s of nonNull) if (collapsed.length === 0 || String(collapsed[collapsed.length - 1]) !== String(s)) collapsed.push(s)
      if (collapsed.length < 3) return { ok: false, reason: `${shape.var} 未观测到轮转(折叠后 ${JSON.stringify(collapsed)})`, observed: collapsed }
      const seq = shape.sequence!
      const idx = (v: Scalar) => seq.findIndex(x => String(x) === String(v))
      for (let k = 1; k < collapsed.length; k++) {
        const a = idx(collapsed[k - 1]), b = idx(collapsed[k])
        if (a < 0 || b < 0 || b !== (a + 1) % seq.length) {
          return { ok: false, reason: `${shape.var} 轮转顺序不符:观测 ${JSON.stringify(collapsed)},期望按 ${JSON.stringify(seq)} 循环`, observed: collapsed }
        }
      }
      return { ok: true, reason: `${shape.var} 按 ${JSON.stringify(seq)} 轮转(${collapsed.length - 1} 次转移)` }
    }
  }
}
