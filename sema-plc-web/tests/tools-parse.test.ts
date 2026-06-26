import { describe, it, expect } from 'vitest'
import { parseResult, isInputTruncated } from '../src/components/left/blocks/tools/parse'

describe('parseResult', () => {
  it('parses ok JSON', () => {
    const r = parseResult({ ok: true, content: '{"success":true,"tick":5}' })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.data.tick).toBe(5)
  })
  it('flags truncated via result.truncated', () => {
    const r = parseResult({ ok: true, content: '{"a":1', truncated: true, rawBytes: 99000 })
    expect(r.kind).toBe('truncated')
    if (r.kind === 'truncated') expect(r.rawBytes).toBe(99000)
  })
  it('falls back to raw on unparseable non-truncated', () => {
    const r = parseResult({ ok: true, content: 'plain text not json' })
    expect(r.kind).toBe('raw')
  })
  it('raw when result missing', () => {
    expect(parseResult(undefined).kind).toBe('raw')
  })
})

describe('isInputTruncated', () => {
  it('detects capInput shape', () => {
    expect(isInputTruncated({ _truncated: true, preview: 'x' })).toBe(true)
    expect(isInputTruncated({ stPath: 'a.st' })).toBe(false)
  })
})
