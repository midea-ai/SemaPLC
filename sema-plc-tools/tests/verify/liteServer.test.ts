import { describe, it, expect } from 'vitest'
import { filterToolsForLite, LITE_TOOLS, isToolAllowed } from '../../src/server.js'

describe('serve --lite', () => {
  it('lite 面只保留只读/低危工具', () => {
    expect(LITE_TOOLS).toEqual(new Set(['plc_status', 'plc_readVariables', 'plc_getLogs', 'plc_detectIO', 'plc_buildSimulation', 'plc_stop']))
    const names = filterToolsForLite(true).map((t: any) => t.name)
    expect(names).not.toContain('plc_forceVariables')
    expect(names).not.toContain('plc_buildAndRun')
    expect(names).toContain('plc_status')
  })
  it('lite 下调用被移除工具返回结构化拒绝(指向 runner),不抛异常', () => {
    expect(isToolAllowed('plc_forceVariables', true)).toBe(false)
    expect(isToolAllowed('plc_forceVariables', false)).toBe(true)
  })
})
