// Tool I/O contracts — must match design spec exactly

export interface Iec2cError {
  line: number
  col: number
  // matiec 报的是闭区间 `line:col-endLine:endCol`,末列**含在** token 内(caret 行的
  // `^~~~` 正好覆盖到它)。转 VSCode Range 这类半开区间时 endCol 要 +1。
  // 老输出没有这两个字段,消费方要按缺省处理(退化成 col 处的一个点)。
  endLine?: number
  endCol?: number
  message: string
  severity: 'error' | 'warning'
  sourceLine: string   // raw ST source text at `line` (1-based); '' if out of range/unavailable
  advice?: string      // actionable repair hint for known matiec error patterns; absent if unrecognized
  // Multi-file projects (st_combiner): `line` is the line in the merged unit;
  // these point back to the originating source file + its local line. Absent for
  // single-file compiles.
  sourceFile?: string
  localLine?: number
}

export interface VariableEntry {
  index: number
  name: string
  type: string
  location: string   // e.g. "%QW0"
}

export interface CompileResult {
  success: boolean
  failedStage: null | 'validate' | 'iec2c' | 'xml2st_debug' | 'xml2st_gluevars' | 'zip'
  iec2c: {
    success: boolean
    errors: Iec2cError[]
    warnings: Iec2cError[]    // matiec warnings (severity 'warning'); populated even on a successful compile
    generatedFiles: string[]  // absolute paths: Config0.c, Res0.c, POUS.c, LOCATED_VARIABLES.h, VARIABLES.csv
  }
  xml2st: {
    debugSuccess: boolean
    glueVarsSuccess: boolean
    errors: string[]
  }
  variableMap: VariableEntry[]
  zipPath: string | null
  errorSummary: string
}

export interface UploadResult {
  success: boolean
  uploadOk: boolean
  uploadError: string | null  // non-null when uploadOk=false
  gccStatus: 'SUCCESS' | 'FAILED' | 'TIMEOUT'
  gccLogs: string[]
  gccErrors: string[]
  durationMs: number
}

export type PlcStatus = 'EMPTY' | 'INIT' | 'RUNNING' | 'STOPPED' | 'ERROR'

export interface StartStopResult {
  success: boolean
  requestedStatus: 'RUNNING' | 'STOPPED'
  actualStatus: PlcStatus
  message: string
}

export interface StatusResult {
  status: PlcStatus
  isRunning: boolean
  runtimeReachable: boolean
}

export interface RuntimeError {
  type: 'watchdog' | 'scan_overrun' | 'segfault' | 'div_by_zero' | 'array_oob' | 'unknown'
  message: string
  line?: number    // line number in runtime log, not in ST source
  advice: string
}

export interface LogsResult {
  logs: string
  lineCount: number
  hasRuntimeErrors: boolean
  runtimeErrors: RuntimeError[]
  lastLine: string
}

export interface VariableValue {
  value: number | boolean | string
  type: string
  index: number
  location: string
}

export interface ReadVariablesResult {
  success: boolean
  variables: Record<string, VariableValue>
  tick?: number | null   // runtime tick__ at read time (advances per scan cycle); lets the agent tell if the PLC is scanning / the value is fresh
  unresolvedNames: string[]
  // For each unresolved name that has a close match in the variableMap, the suggested
  // canonical name (debug names are lowercased; FB outputs are 'instance.port').
  nameSuggestions?: Record<string, string>
  errorMessage: string | null
}

export interface TraceSample {
  elapsedMs: number                          // ms since trace start (client-side wall clock)
  tick: number | null                        // runtime tick__ (advances per scan cycle); null if unavailable
  values: (number | boolean | string | null)[]   // 按 columns 顺序的裸值;缺失为 null;整帧失败为 []
}

export interface TraceResult {
  success: boolean
  columns: string[]
  meta: Record<string, { type: string; index: number; location: string }>
  samples: TraceSample[]
  unresolvedNames: string[]
  nameSuggestions?: Record<string, string>
  // Achieved average sampling period (each sample is a full debug-socket round
  // trip, ~50ms floor — a smaller requested intervalMs is physically unattainable).
  actualIntervalMs?: number
  note?: string   // budget truncation / all-failed / sub-floor resolution advisory
  errorMessage: string | null
}

export interface TraceInput {
  varNames?: string[]      // omit to trace the whole variableMap
  intervalMs?: number      // spacing between samples (default 200)
  durationMs?: number      // total trace duration; ignored if `samples` is given (default 2000)
  samples?: number         // exact sample count (overrides durationMs); clamped to [1, 200]
  timeoutMs?: number       // per-sample WebSocket timeout (default 2000)
}

// ── plc_record (0x46 flight-recorder readout) ───────────────────────────────
export interface RecordInput {
  varNames: string[]        // REQUIRED — context-explosion gate: full-map dumps are forbidden
  fromTick?: number         // closes the loop with when.tickAtMet / pulse.startTick
  lastScans?: number        // default 250; fromTick wins when both are given. 单位为扫描周期数（非帧数），抽稀(decimation>1)时窗口自动 ×decimation。
  timeoutMs?: number
}

export interface RecordSeries {
  name: string
  type: string
  first: number | boolean | string
  transitions: Array<[number, number | boolean | string]>   // [tick, newValue] — changes only
  truncated: boolean        // transitions exceeded the cap; see summary + fullDumpFile
  // min/max/monotonic only for numeric series; non-numeric (BOOL/BigInt-string) gets last only.
  summary?: { min?: number; max?: number; last: number | boolean | string; monotonic?: boolean }
}

export interface RecordResult {
  success: boolean
  window: { fromTick: number; toTick: number; scanMs: number | null; decimation: number } | null
  series: RecordSeries[]
  unresolvedNames: string[]
  nameSuggestions?: Record<string, string>
  skippedUnrecordable: string[]    // resolved vars the recorder skipped (STRING etc., size=0) — fail-loud
  fullDumpFile: string | null      // full decoded window on disk when any series was truncated
  programMd5Verified: boolean
  note?: string                    // md5-unknown degradation etc.
  errorMessage: string | null
}

export interface WaitForInput {
  varName: string
  op: '==' | '!=' | '>' | '>=' | '<' | '<='
  value: number | boolean | string
  timeoutMs?: number   // total wait budget (default 5000)
  intervalMs?: number  // poll spacing (default 200)
}

export interface WaitForResult {
  success: boolean                              // condition met within the timeout
  timedOut: boolean                             // budget elapsed without the condition becoming true
  finalValue: number | boolean | string | null // last observed value of varName
  tick: number | null                           // runtime tick at the last poll
  elapsedMs: number
  polls: number
  nameSuggestion?: string                       // present when varName is unresolved
  errorMessage: string | null                   // non-null on error (unresolved name, read failure)
}

// plc_verifyBehavior — atomically "force inputs → wait for a downstream condition".
// Encodes the only correct way to verify edge/fast-transient logic: assert the
// persistent DOWNSTREAM effect (pusher fires, counter ticks), never snapshot the
// 1-scan-cycle transient (which the force→read round-trip latency always misses).

export interface VerifyExpectCondition {
  varName: string
  op: '==' | '!=' | '>' | '>=' | '<' | '<='
  value: number | boolean | string
  timeoutMs?: number                              // default 5000
  intervalMs?: number                             // poll spacing, default 200
}

export interface VerifyBehaviorInput {
  set: Record<string, number | boolean>           // inputs to force (held during the wait)
  /** Single condition or array of conditions. All must be met for success. */
  expect: VerifyExpectCondition | VerifyExpectCondition[]
  settleMs?: number                               // wait after force, before polling; default 0
  releaseAfter?: boolean                          // release the forced inputs when done; default true (avoids cross-case contamination)
}

export interface VerifyExpectResult {
  varName: string
  matched: boolean
  finalValue: number | boolean | string | null
  timedOut: boolean
  elapsedMs: number
  polls: number
  errorMessage: string | null
}

export interface VerifyBehaviorResult {
  success: boolean                                // force succeeded AND expect condition(s) met
  forced: ForcedItem[]
  forceFailed: ForceFailure[]
  /** Single result when input was a single expect; array when input was an array. */
  expect: VerifyExpectResult | VerifyExpectResult[]
  released: string[]                              // inputs actually released (when releaseAfter)
  verdict: string                                 // human-readable conclusion
}

export interface ForceVariablesInput {
  // Map of variable name → value to force. Type must match the variableMap entry.
  set?: Record<string, number | boolean | string>
  // Names of variables to release (clear the forced override).
  release?: string[]
  timeoutMs?: number
  /** If set, auto-release all `set` variables after this many ms (creates a pulse).
   *  Useful for triggering R_TRIG / F_TRIG edge detectors — a held force only
   *  produces one edge; pulseMs releases and lets a subsequent force produce another. */
  pulseMs?: number
  /** Tick-VERIFIED minimal pulse: hold the force until the runtime tick has advanced
   *  ≥ this many scan cycles, then release. Unlike pulseMs (blind wall clock — a
   *  too-short pulse can straddle zero scan boundaries and silently produce no edge),
   *  this proves the program scanned the forced value; see result.pulse evidence.
   *  Takes priority over pulseMs. Clamped to [1, 50]. */
  pulseScans?: number
  /** Condition-triggered force: poll this condition and fire the force THE MOMENT it
   *  holds, over one persistent debug socket (gap ~1 scan). Replaces the racy
   *  waitFor→force pattern whose two round trips lose 3-5 scans. Composes with
   *  pulseScans/pulseMs. On timeout no force is applied. */
  when?: {
    varName: string
    op: '==' | '!=' | '>' | '>=' | '<' | '<='
    value: number | boolean | string
    timeoutMs?: number   // total condition wait budget (default 5000)
    pollMs?: number      // extra delay between polls (default 0 — poll back-to-back)
  }
}

/** Evidence for a condition-triggered (when) force. */
export interface WhenEvidence {
  met: boolean
  polls: number
  conditionValue: unknown      // condition variable's value at the met poll (or last seen)
  tickAtMet: number | null     // tick of the poll that satisfied the condition
  tickAtForced: number | null  // tick right after the force was acknowledged
  gapScans: number | null      // tickAtForced - tickAtMet — how late the force landed
}

/** Tick evidence for a pulse (pulseScans / pulseMs) force. */
export interface PulseEvidence {
  startTick: number | null    // tick observed right after the force took effect
  releaseTick: number | null  // last tick observed before release
  scansHeld: number | null    // releaseTick - startTick — lower bound of scans that saw the value
  verified: boolean           // true iff the program demonstrably scanned the forced value (≥ requested scans for pulseScans)
  note?: string
}

export interface ForcedItem {
  name: string
  index: number
  type: string
  // What was actually written (after type coercion). For BOOL: true/false; for
  // numeric: the JS number; for LINT/ULINT/LWORD: string (BigInt-safe).
  value: number | boolean | string
}

export interface ForceFailure {
  name: string
  reason: string
}

export interface ForceVariablesResult {
  success: boolean              // true iff failed[] is empty
  forced: ForcedItem[]          // variables successfully forced to a value
  released: string[]            // variables whose force was released
  failed: ForceFailure[]        // name + reason (unresolved, type mismatch, runtime error, etc.)
  pulse?: PulseEvidence         // present when pulseScans/pulseMs was used
  when?: WhenEvidence           // present when a `when` condition was used
  errorMessage: string | null   // non-null if a global failure prevented all forces (e.g. no auth)
}

export interface BuildAndRunResult {
  success: boolean
  failedStage: null | 'compile' | 'upload' | 'gcc' | 'start'
  compile: CompileResult
  upload: UploadResult | null
  start: StartStopResult | null
  finalStatus: PlcStatus | null
  agentSummary: string
}

export interface CompileInput {
  stCode: string
}

export interface ReadVariablesInput {
  varNames?: string[]
  timeoutMs?: number
}

export interface GetLogsInput {
  lines?: number
}

export interface PlcState {
  // After plc.compile success this is non-null; readVariables uses variableMap to resolve indices.
  lastCompile: {
    timestamp: string
    stCode: string
    zipPath: string
    variableMap: VariableEntry[]
  } | null
}

// ── plc_detectIO ──────────────────────────────────────────────────────────────
export type ModbusType = 'coil' | 'discrete_input' | 'input_register' | 'holding_register'

export interface DetectedIO {
  name: string
  address: string                 // ST located address, e.g. "%QX0.0"
  type: string                    // ST data type from the declaration, e.g. "BOOL"; '' if absent
  direction: 'input' | 'output' | 'memory'  // from the location prefix I/Q/M
  // Modbus mapping per OpenPLC rules (§10.3). null for address classes that have no
  // Modbus equivalent (memory %M*, byte/dword forms %IB/%ID, etc.) — the variable is
  // still listed so callers see the full located-IO surface.
  modbusType: ModbusType | null
  modbusAddr: number | null
  // Optional semantic hint from io_map.yaml (single source of truth). When set,
  // it takes priority over name heuristics in part selection (suggestScene/buildSimulation).
  component?: string
}

export interface DetectIOInput {
  stCode: string
}

export interface DetectIOResult {
  io: DetectedIO[]
  count: number
}

// OpenPLC modbus_slave plugin config (schema validated against the live runtime:
// network_configuration + buffer_mapping consumed by simple_modbus.py).
export interface ModbusSlaveConfig {
  network_configuration: { host: string; port: number }
  buffer_mapping: {
    coils: { qx_bits: number }                 // %QX → coils
    discrete_inputs: { ix_bits: number }       // %IX → discrete inputs
    holding_registers: { qw_count: number }    // %QW → holding registers
    input_registers: { iw_count: number }      // %IW → input registers
  }
}

export interface ModbusSlaveConfigOptions {
  host?: string   // default '0.0.0.0'
  port?: number   // default 502
}

// ── plc_check (rusty) ───────────────────────────────────────────────────────
export interface RustyError {
  code: string                 // e.g. "E006"
  message: string
  line: number | null
  col: number | null
  // 出错文件在容器内的路径。一次 check 同时送检 stdlib,不带路径就没法把 stdlib 的错
  // 和用户代码的错分开(见 rustyErrorParser)。无 codespan 位置行时缺省。
  file?: string
}

export interface CheckInput {
  stCode: string               // ST source; a bare FUNCTION_BLOCK is allowed
}

export interface CheckResult {
  ok: boolean                  // true iff `plc --check` exited 0
  errors: RustyError[]         // parsed error[Exxx] diagnostics (empty when ok)
  raw: string                  // ANSI-stripped compiler output
  errorMessage: string | null  // non-null only on infra failure (docker/plc missing)
}
