import { describe, it, expect } from 'vitest'
import { pickThree } from '../../src/components/left/ChatPanel'

describe('pickThree (example scenario shuffle)', () => {
  it('returns 3 distinct in-range indices', () => {
    for (let n = 0; n < 50; n++) {
      const r = pickThree()
      expect(r).toHaveLength(3)
      expect(new Set(r).size).toBe(3)             // distinct
      for (const i of r) expect(i).toBeGreaterThanOrEqual(0)
    }
  })

  it('avoids returning the exact same group as the current one', () => {
    // With 10 scenarios, an exact repeat of all 3 is improbable and explicitly retried.
    for (let n = 0; n < 50; n++) {
      const cur = pickThree()
      const next = pickThree(cur)
      const same = next.length === 3 && next.every((v) => cur.includes(v))
      expect(same).toBe(false)
    }
  })
})
