import { describe, it, expect } from 'vitest'
import { MCP_SAFE_MAX_MS, clampToMcpBudget } from '../src/mcpBudget.js'

describe('clampToMcpBudget', () => {
  it('caps a too-large value to MCP_SAFE_MAX_MS', () => {
    expect(clampToMcpBudget(120_000, 5000)).toBe(MCP_SAFE_MAX_MS)
  })
  it('keeps a value already under the cap', () => {
    expect(clampToMcpBudget(8000, 5000)).toBe(8000)
  })
  it('uses the fallback when undefined', () => {
    expect(clampToMcpBudget(undefined, 5000)).toBe(5000)
  })
  it('MCP_SAFE_MAX_MS leaves headroom under the 60s MCP default', () => {
    expect(MCP_SAFE_MAX_MS).toBeLessThanOrEqual(55_000)
  })
})
