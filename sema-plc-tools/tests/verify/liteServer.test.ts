import { describe, it, expect } from 'vitest'
import { filterToolsForLite, LITE_TOOLS, OFFLINE_TOOLS, isToolAllowed } from '../../src/server.js'

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

describe('无容器引擎(engineless)', () => {
  it('只剩纯本地工具 —— 编译/运行/检查全部从 MCP 移除', () => {
    const names = filterToolsForLite(false, true).map((t: any) => t.name)
    expect(new Set(names)).toEqual(OFFLINE_TOOLS)
    for (const gone of ['plc_compile', 'plc_check', 'plc_buildAndRun', 'plc_status']) {
      expect(names).not.toContain(gone)
    }
  })

  it('OFFLINE_TOOLS ⊆ LITE_TOOLS —— 两个收面叠加后不会空盘', () => {
    for (const t of OFFLINE_TOOLS) expect(LITE_TOOLS.has(t)).toBe(true)
    expect(filterToolsForLite(true, true).length).toBe(OFFLINE_TOOLS.size)
  })

  it('engineless 优先于 lite:lite 白名单里的 plc_status 照样被拒', () => {
    expect(isToolAllowed('plc_status', true, true)).toBe(false)
    expect(isToolAllowed('plc_status', true, false)).toBe(true)
    expect(isToolAllowed('plc_buildSimulation', false, true)).toBe(true)
  })
})
