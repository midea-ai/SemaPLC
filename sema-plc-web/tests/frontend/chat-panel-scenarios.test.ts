import { describe, it, expect } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { pickThree, shouldSubmitOnEnter } from '../../src/components/left/ChatPanel'

function enterEvent(overrides: Partial<ReactKeyboardEvent<HTMLTextAreaElement>> = {}) {
  return {
    key: 'Enter',
    shiftKey: false,
    keyCode: 13,
    nativeEvent: { isComposing: false },
    ...overrides,
  } as ReactKeyboardEvent<HTMLTextAreaElement>
}

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

describe('shouldSubmitOnEnter', () => {
  it('submits plain Enter', () => {
    expect(shouldSubmitOnEnter(enterEvent(), false)).toBe(true)
  })

  it('does not submit multiline or IME composition Enter presses', () => {
    expect(shouldSubmitOnEnter(enterEvent({ shiftKey: true }), false)).toBe(false)
    expect(shouldSubmitOnEnter(enterEvent(), true)).toBe(false)
    expect(shouldSubmitOnEnter(enterEvent({ nativeEvent: { isComposing: true } as KeyboardEvent }), false)).toBe(false)
    expect(shouldSubmitOnEnter(enterEvent({ keyCode: 229 }), false)).toBe(false)
  })
})
