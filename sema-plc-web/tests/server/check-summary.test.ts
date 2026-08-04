// /api/check 的三态定性。上一轮把 stdlib 过滤放在前端,结果 rusty 对 stdlib 必 panic ⇒
// ok 恒 false ⇒ 干净文件永远红字「0 error(s)」;且前端硬编码的 stdlib 前缀一设环境变量就全漏。
// 两条都是这个函数负责堵住的,所以判据全在这里验。
import { describe, it, expect } from 'vitest'
import { summarizeCheck } from '../../server/routes/check.js'

const STDLIB = '/opt/iec61131-stdlib'
// 真实容器上 raw 一定带这一行(rusty v0.5.0 typesystem.rs:742),truncated 就靠它认。
const PANIC = "thread 'main' panicked at compiler/plc_driver/src/typesystem.rs:742"

const base = { ok: false, errors: [], raw: '', errorMessage: null }
const stdlibErr = { code: 'E048', file: `${STDLIB}/to_bit.st`, line: 12, col: 3, message: 'stdlib noise' }
const userErr = { code: 'E007', file: '/tmp/plc-check-xk29d.st', line: 2, col: 5, message: 'real user error' }

describe('summarizeCheck 三态', () => {
  it('有用户代码错误 → errors(stdlib 的那些不算数也不外传)', () => {
    const r = summarizeCheck({ ...base, errors: [stdlibErr, userErr], raw: PANIC }, STDLIB)
    expect(r.outcome).toBe('errors')
    expect(r.errors).toEqual([userErr])
  })

  it('无用户代码错误 + 跑完 → passed', () => {
    expect(summarizeCheck({ ...base, ok: true, raw: 'ok' }, STDLIB).outcome).toBe('passed')
  })

  it('无用户代码错误 + 检查器 panic → truncated,不是 passed 也不是 errors', () => {
    // 这就是真实容器上的常态:28 条全来自 stdlib,exit 101。
    const r = summarizeCheck({ ...base, errors: [stdlibErr], raw: PANIC }, STDLIB)
    expect(r.outcome).toBe('truncated')
    expect(r.errors).toEqual([])
  })

  it('无位置行(没有 file)的全局错留下 —— 它归不到 stdlib 头上', () => {
    const global = { code: 'E999', file: undefined, line: null, col: null, message: 'no entry point' }
    const r = summarizeCheck({ ...base, errors: [stdlibErr, global], raw: PANIC }, STDLIB)
    expect(r.outcome).toBe('errors')
    expect(r.errors).toEqual([global])
  })

  it('按传进来的目录过滤(PLC_CHECK_STDLIB_DIR 改了也不漏)', () => {
    const custom = { ...stdlibErr, file: '/srv/iec-lib/to_bit.st' }
    expect(summarizeCheck({ ...base, errors: [custom], raw: PANIC }, '/srv/iec-lib').errors).toEqual([])
    // 反过来:同前缀的兄弟目录不能误杀
    const sibling = { ...stdlibErr, file: '/srv/iec-lib-extra/x.st' }
    expect(summarizeCheck({ ...base, errors: [sibling], raw: PANIC }, '/srv/iec-lib').errors).toEqual([sibling])
  })
})
