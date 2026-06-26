import { vi } from 'vitest'
export function mkDeps(over: Partial<any> = {}) {
  return {
    force: vi.fn(async () => ({ success: true, forced: [], released: [], failed: [], errorMessage: null })),
    verifyBehavior: vi.fn(async () => ({ success: true, forced: [], forceFailed: [], expect: [], released: ['a'], verdict: 'ok' })),
    waitFor: vi.fn(async () => ({ success: true, timedOut: false, finalValue: 1, tick: 5, elapsedMs: 10, polls: 1, errorMessage: null })),
    trace: vi.fn(async () => ({ success: true, columns: ['b'], meta: {}, samples: [
      { elapsedMs: 0, tick: 1, values: [0] }, { elapsedMs: 200, tick: 2, values: [0] },
    ], unresolvedNames: [], errorMessage: null })),
    record: vi.fn(), readVariables: vi.fn(async () => ({ success: true, variables: {}, unresolvedNames: [], errorMessage: null })),
    registerForces: vi.fn(), unregisterForces: vi.fn(),
    budgetMs: 30_000, now: () => Date.now(),
    ...over,
  } as any
}
