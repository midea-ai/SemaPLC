import * as fs from 'fs'
import * as path from 'path'
import { bus, type BusMessage } from './event-bus.js'
import { plcStateFileForWorkspace, readPlcState } from './state-reader.js'
import { handleBuildAndRun } from '../../sema-plc-tools/dist/tools/buildAndRun.js'
import { handleCompile } from '../../sema-plc-tools/dist/tools/compile.js'
import { handleUpload } from '../../sema-plc-tools/dist/tools/upload.js'
import { handleStart } from '../../sema-plc-tools/dist/tools/start.js'
import { handleStop } from '../../sema-plc-tools/dist/tools/stop.js'
import { handleStatus } from '../../sema-plc-tools/dist/tools/status.js'
import { handleGetLogs } from '../../sema-plc-tools/dist/tools/getLogs.js'
import { handleForceVariables } from '../../sema-plc-tools/dist/tools/forceVariables.js'
import { RuntimeClient } from '../../sema-plc-tools/dist/client/runtime.js'
import { dockerBin, type PlcConfig } from '../../sema-plc-tools/dist/config.js'

// Minimal shape PlcController needs from PlcMonitor (avoids a type cycle when
// running with the injected-mock test setup).
export interface MonitorLike {
  setMuted(muted: boolean): void
}

export interface PlcControllerOptions {
  workspace: string
  monitor?: MonitorLike
  // Injectable tool handlers (defaults to real plc-tools imports)
  _handleBuildAndRun?: typeof handleBuildAndRun
  _handleCompile?: typeof handleCompile
  _handleUpload?: typeof handleUpload
  _handleStart?: typeof handleStart
  _handleStop?: typeof handleStop
  _handleStatus?: typeof handleStatus
  _handleGetLogs?: typeof handleGetLogs
  _handleForceVariables?: typeof handleForceVariables
}

export class PlcController {
  private client: any
  private cfg: PlcConfig
  private workspace: string
  private monitor: MonitorLike | undefined
  private _handleBuildAndRun: typeof handleBuildAndRun
  private _handleCompile: typeof handleCompile
  private _handleUpload: typeof handleUpload
  private _handleStart: typeof handleStart
  private _handleStop: typeof handleStop
  private _handleStatus: typeof handleStatus
  private _handleGetLogs: typeof handleGetLogs
  private _handleForceVariables: typeof handleForceVariables

  constructor(opts: PlcControllerOptions | string) {
    // Allow legacy single-string constructor for backwards compat with plan's signature
    const o: PlcControllerOptions = typeof opts === 'string' ? { workspace: opts } : opts
    this.workspace = o.workspace
    this.cfg = {
      url: process.env.PLC_URL ?? 'https://localhost:8443',
      container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
      checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
      user: process.env.PLC_USER ?? 'admin',
      password: process.env.PLC_PASSWORD ?? 'admin123',
      stateFile: plcStateFileForWorkspace(o.workspace),
      poolSize: Number(process.env.PLC_POOL_SIZE) || 1, // web 控制器不分池;并行 verify 在 plc-tools CLI 进程内按 PLC_POOL_SIZE 决定
      dockerBin: dockerBin(),
    }
    this.client = new RuntimeClient(this.cfg.url, this.cfg.user, this.cfg.password)
    this.monitor = o.monitor
    this._handleBuildAndRun = o._handleBuildAndRun ?? handleBuildAndRun
    this._handleCompile = o._handleCompile ?? handleCompile
    this._handleUpload = o._handleUpload ?? handleUpload
    this._handleStart = o._handleStart ?? handleStart
    this._handleStop = o._handleStop ?? handleStop
    this._handleStatus = o._handleStatus ?? handleStatus
    this._handleGetLogs = o._handleGetLogs ?? handleGetLogs
    this._handleForceVariables = o._handleForceVariables ?? handleForceVariables
    bus.on((m) => this.handle(m).catch((e) => {
      bus.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }))
  }

  setMonitor(monitor: MonitorLike): void {
    this.monitor = monitor
  }

  switchWorkspace(newWorkspace: string): void {
    this.workspace = newWorkspace
    this.cfg.stateFile = plcStateFileForWorkspace(newWorkspace)
  }

  private async handle(m: BusMessage): Promise<void> {
    if (!('type' in m)) return
    switch (m.type) {
      case 'internal:plc-run':
        await this.run(m.stCode)
        break
      case 'internal:plc-stop':
        await this.stop()
        break
      case 'internal:plc-fetch-logs':
        await this.fetchLogs(m.lines ?? 50)
        break
      case 'internal:plc-force':
        await this.force(m.set, m.release)
        break
      default:
        break
    }
  }

  private async force(set?: Record<string, number | boolean>, release?: string[]): Promise<void> {
    // verify runner 运行中(.plc-act/running.lock 存在且 <150s 新)时拒绝 sim 交互 force,
    // 防止用户点击与 runner 工况互相覆盖(评审 1.3);陈旧 lock(异常残留)不拦。
    const lock = path.join(this.workspace, '.plc-act', 'running.lock')
    try {
      const st = fs.statSync(lock)
      if (Date.now() - st.mtimeMs < 150_000) {
        this.emitLog('tool', 'warn', '验证运行中,暂不接受仿真交互(verify 结束后自动恢复)')
        return
      }
    } catch { /* 无 lock,正常放行 */ }

    const toolId = `user-${Date.now()}`
    const input = { set, release }
    bus.emit({ type: 'agent:tool-start', toolId, name: 'plc_forceVariables', input })
    try {
      const result = await this._handleForceVariables(input as any, this.cfg)
      bus.emit({ type: 'agent:tool-complete', toolId, name: 'plc_forceVariables', result, isError: !result.success })
      bus.emit({
        type: 'plc:force-result',
        forced: (result.forced ?? []).map((f: any) => f.name),
        released: result.released ?? [],
        failed: result.failed ?? [],
        error: result.errorMessage ?? null,
      })
      const setDesc = set ? Object.entries(set).map(([k, v]) => `${k}=${v}`).join(', ') : ''
      const relDesc = release && release.length ? `release ${release.join(', ')}` : ''
      const what = [setDesc, relDesc].filter(Boolean).join(' | ')
      if (result.success) {
        this.emitLog('tool', 'info', `plc_forceVariables ✓ ${what}`)
      } else {
        this.emitLog('tool', 'error', `plc_forceVariables ✗ ${result.errorMessage ?? ''}`)
        for (const f of result.failed ?? []) this.emitLog('tool', 'error', `  ${f.name}: ${f.reason}`)
      }
      // Force changes the input value the runtime sees; nudge the monitor to
      // re-emit values on the next tick so the Vars panel updates promptly.
      this.monitor?.setMuted(false)
    } catch (e) {
      bus.emit({ type: 'agent:tool-complete', toolId, name: 'plc_forceVariables', result: String(e), isError: true })
      this.emitLog('tool', 'error', `plc_forceVariables threw: ${e}`)
    }
  }

  private async run(stCode: string): Promise<void> {
    const toolId = `user-${Date.now()}`
    bus.emit({ type: 'agent:tool-start', toolId, name: 'plc_buildAndRun', input: { stCode: stCode.slice(0, 80) } })
    // Mute the polling monitor during the transition so the UI doesn't see
    // intermediate INIT / ERROR / pre-restart states. plc-tools' updated
    // handleStart polls until the runtime stabilises before we emit the final state.
    this.monitor?.setMuted(true)
    try {
      // 重新运行:若当前正在 RUNNING,先停止再编译/上传/启动——规避 OpenPLC upload→start
      // 换载竞态(start 偶发拉起旧程序)。stop 在 muted 区内,UI 不闪中间态;探测/停止
      // 失败不阻断,交给后续 buildAndRun。
      try {
        const st = await this._handleStatus(this.client)
        if (st.status === 'RUNNING') await this._handleStop(this.client)
      } catch { /* 状态探测或停止失败:继续 buildAndRun */ }
      const result = await this._handleBuildAndRun({ stCode }, {
        compile: (i: any) => this._handleCompile(i, this.cfg),
        upload: () => this._handleUpload({}, this.cfg),
        start: () => this._handleStart(this.client),
      })
      bus.emit({
        type: 'agent:tool-complete',
        toolId,
        name: 'plc_buildAndRun',
        result: { success: result.success, failedStage: result.failedStage, finalStatus: result.finalStatus, agentSummary: result.agentSummary },
        isError: !result.success,
      })
      if (result.finalStatus) bus.emit({ type: 'plc:state', status: result.finalStatus as any })
      if (result.success) {
        // Compile succeeded → state.json.variableMap was just rewritten; push the
        // fresh map so the Vars panel doesn't keep showing the previous program's
        // variables. Match what sema-bridge does for the Agent-driven path.
        try {
          const state = readPlcState(this.cfg.stateFile)
          bus.emit({ type: 'plc:variables', map: state.variableMap })
        } catch {}
        this.emitLog('tool', 'info', `plc_buildAndRun ✓ → ${result.finalStatus}`)
      } else {
        // Failure — surface the FULL diagnostic so the user can see WHY it failed,
        // not just "✗ compile". Each stage's errors go to the bottom log panel.
        this.emitBuildFailureDetail(result)
      }
    } catch (e) {
      bus.emit({ type: 'agent:tool-complete', toolId, name: 'plc_buildAndRun', result: String(e), isError: true })
      this.emitLog('tool', 'error', `plc_buildAndRun threw: ${e}`)
    } finally {
      this.monitor?.setMuted(false)
    }
  }

  private async stop(): Promise<void> {
    const toolId = `user-${Date.now()}`
    bus.emit({ type: 'agent:tool-start', toolId, name: 'plc_stop', input: {} })
    this.monitor?.setMuted(true)
    try {
      const result = await this._handleStop(this.client)
      bus.emit({ type: 'agent:tool-complete', toolId, name: 'plc_stop', result, isError: !result.success })
      bus.emit({ type: 'plc:state', status: (result.actualStatus ?? 'STOPPED') as any })
      this.emitLog('tool', result.success ? 'info' : 'warn', `plc_stop ${result.success ? '✓' : '✗ ' + result.message}`)
    } catch (e) {
      bus.emit({ type: 'agent:tool-complete', toolId, name: 'plc_stop', result: String(e), isError: true })
      this.emitLog('tool', 'error', `plc_stop threw: ${e}`)
    } finally {
      this.monitor?.setMuted(false)
    }
  }

  private async fetchLogs(lines: number): Promise<void> {
    try {
      const result = await this._handleGetLogs({ lines }, this.client)
      for (const line of result.logs.split('\n').slice(-lines).filter(Boolean)) {
        this.emitLog('runtime', 'info', line)
      }
      if (result.runtimeErrors.length > 0) {
        bus.emit({ type: 'plc:runtime-error', errors: result.runtimeErrors as any })
      }
    } catch (e) {
      this.emitLog('runtime', 'error', `fetchLogs failed: ${e}`)
    }
  }

  /**
   * Surface the full diagnostic of a failed plc_buildAndRun to the bottom log
   * panel. Picks the relevant detail for whichever stage failed so the user
   * sees the actual matiec/gcc error, not just "compile failed".
   */
  private emitBuildFailureDetail(result: any): void {
    const stage = result.failedStage ?? 'unknown'
    this.emitLog('tool', 'error', `plc_buildAndRun ✗ failed at stage: ${stage}`)
    if (result.agentSummary) {
      this.emitLog('tool', 'error', result.agentSummary)
    }

    // Compile stage — matiec (iec2c) errors
    const iec2cErrors = result.compile?.iec2c?.errors ?? []
    for (const e of iec2cErrors.slice(0, 20)) {
      const loc = e.line != null ? ` (line ${e.line}${e.column != null ? `:${e.column}` : ''})` : ''
      const msg = typeof e === 'string' ? e : (e.message ?? JSON.stringify(e))
      this.emitLog('iec2c', 'error', `${msg}${loc}`)
    }
    const xml2stErrors = result.compile?.xml2st?.errors ?? []
    for (const e of xml2stErrors.slice(0, 10)) {
      this.emitLog('iec2c', 'error', String(e))
    }

    // Upload / GCC stage
    if (result.upload) {
      if (result.upload.uploadError) {
        this.emitLog('gcc', 'error', `upload: ${result.upload.uploadError}`)
      }
      for (const e of (result.upload.gccErrors ?? []).slice(0, 20)) {
        this.emitLog('gcc', 'error', String(e))
      }
    }

    // Start stage
    if (result.start && stage === 'start') {
      this.emitLog('runtime', 'error', `start: status=${result.start.actualStatus} message=${result.start.message ?? ''}`)
    }
  }

  private emitLog(source: 'tool' | 'runtime' | 'iec2c' | 'gcc', level: 'info' | 'warn' | 'error', message: string) {
    bus.emit({ type: 'log', source, level, message, ts: Date.now() })
  }
}
