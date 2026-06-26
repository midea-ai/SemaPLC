import { describe, it, expect } from 'vitest'
import { parsePlanText } from '../../src/verify/planParse.js'

describe('parsePlanText (lenient JSON)', () => {
  it('strips // and /* */ comments and trailing commas', () => {
    const txt = `{
      // 弱模型会照抄示例里的注释
      "program": "a.st", /* inline */
      "cases": [ { "name": "n", "type": "steady", "set": {"a": true}, "expect": [{"var":"b","op":"==","value":true},], }, ],
    }`
    const r = parsePlanText(txt)
    expect(r.errors).toEqual([])
    expect(r.raw?.program).toBe('a.st')
  })
  it('does not strip // inside string values', () => {
    const r = parsePlanText('{"program": "dir//a.st", "cases": []}')
    expect(r.raw?.program).toBe('dir//a.st')
  })
  it('reports JSON syntax error with position context, not an exception', () => {
    const r = parsePlanText('{"program": "a.st", "cases": [}')
    expect(r.raw).toBeNull()
    expect(r.errors[0].message).toMatch(/JSON/)
  })
})
