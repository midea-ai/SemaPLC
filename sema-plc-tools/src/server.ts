import * as path from 'path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { loadConfig } from './config.js'
import { RuntimeClient } from './client/runtime.js'
import { handleCompile } from './tools/compile.js'
import { handleUpload } from './tools/upload.js'
import { handleStart } from './tools/start.js'
import { handleStop } from './tools/stop.js'
import { handleStatus } from './tools/status.js'
import { handleGetLogs } from './tools/getLogs.js'
import { handleReadVariables } from './tools/readVariables.js'
import { handleForceVariables } from './tools/forceVariables.js'
import { handleBuildAndRun } from './tools/buildAndRun.js'
import { handleTrace } from './tools/trace.js'
import { handleRecord } from './tools/record.js'
import { handleWaitFor } from './tools/waitFor.js'
import { handleVerifyBehavior } from './tools/verifyBehavior.js'
import { handleCheck } from './tools/check.js'
import { detectIO } from './tools/detectIO.js'
import { handleBuildSimulation } from './tools/buildSimulation.js'
import { stHashOf } from './verify/hash.js'
import { PARTS_CATALOG_MD } from './tools/partsCatalog.js'
import { resolveStInput } from './tools/resolveStInput.js'
import { resolveProject, resolveScene, translateErrorLine } from './tools/resolveProject.js'
import type { CombineResult } from './tools/stCombiner.js'
import type { ForceVariablesInput, TraceInput, RecordInput, WaitForInput, VerifyBehaviorInput, Iec2cError } from './types.js'

const ST_INPUT_HINT = '下次只传 stPath 即可,保持工作区干净(stCode 已忽略,以 stPath 为准)。'

const TOOLS = [
  {
    name: 'plc_compile',
    description: 'Compile ST source code: iec2c → xml2st → ZIP. Returns structured errors with line/col and the offending source line for agent repair.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stCode: { type: 'string', description: 'IEC 61131-3 ST source. Prefer stPath in the app.' },
        stPath: { type: 'string', description: 'Workspace-relative (or absolute) path to a .st file; read as the source. Preferred over stCode to keep one source of truth.' },
        stPaths: { type: 'array', items: { type: 'string' }, description: 'Multi-file project: workspace-relative .st paths merged (in this order) into one compilation unit. Must contain exactly one PROGRAM + one CONFIGURATION across all files.' },
        projectDir: { type: 'string', description: 'Multi-file project: a workspace-relative dir; its single-level *.st files are merged (alphabetical). Use stPaths instead when you need a specific order.' },
      },
    },
  },
  {
    name: 'plc_detectIO',
    description: 'Extract the located-IO surface from ST source by scanning `AT %…` declarations. Returns each located variable with its ST address, data type, direction (input/output/memory), and the OpenPLC Modbus mapping (coil/discrete_input/input_register/holding_register + numeric address). Pure/offline — no compile or running PLC needed. Use to auto-derive an IO map (e.g. before binding to a visualization) without hand-listing addresses.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stCode: { type: 'string', description: 'IEC 61131-3 ST source. Prefer stPath in the app.' },
        stPath: { type: 'string', description: 'Workspace-relative (or absolute) path to a .st file; read as the source. Preferred over stCode to keep one source of truth.' },
        stPaths: { type: 'array', items: { type: 'string' }, description: 'Multi-file project: workspace-relative .st paths merged (in this order) into one compilation unit. Must contain exactly one PROGRAM + one CONFIGURATION across all files.' },
        projectDir: { type: 'string', description: 'Multi-file project: a workspace-relative dir; its single-level *.st files are merged (alphabetical). Use stPaths instead when you need a specific order.' },
      },
    },
  },
  {
    name: 'plc_check',
    description: 'Syntax/semantic CHECK of ST using the rusty (PLC-lang) compiler — accepts a BARE FUNCTION_BLOCK / FUNCTION with no PROGRAM/CONFIGURATION wrapper. Same compiler as the benchmark eval, so a pass aligns with eval. CHECK-ONLY: passing does NOT mean it runs on OpenPLC — to actually run, still use plc_buildAndRun (matiec). Returns { ok, errors:[{code,message,line,col}], raw }.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stCode: { type: 'string', description: 'IEC 61131-3 ST source. Prefer stPath in the app.' },
        stPath: { type: 'string', description: 'Workspace-relative (or absolute) path to a .st file; read as the source. Preferred over stCode to keep one source of truth.' },
      },
    },
  },
  {
    name: 'plc_upload',
    description: 'Upload last compiled ZIP to OpenPLC Runtime and wait for GCC compilation. Returns full GCC logs. Requires a prior successful plc_compile or plc_buildAndRun (uses the cached ZIP).',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'plc_buildAndRun',
    description: 'Compile ST → upload → start PLC in one call. Returns structured result per stage. Use this for the full workflow.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stCode: { type: 'string', description: 'IEC 61131-3 ST source. Prefer stPath in the app.' },
        stPath: { type: 'string', description: 'Workspace-relative (or absolute) path to a .st file; read as the source. Preferred over stCode to keep one source of truth.' },
        stPaths: { type: 'array', items: { type: 'string' }, description: 'Multi-file project: workspace-relative .st paths merged (in this order) into one compilation unit. Must contain exactly one PROGRAM + one CONFIGURATION across all files.' },
        projectDir: { type: 'string', description: 'Multi-file project: a workspace-relative dir; its single-level *.st files are merged (alphabetical). Use stPaths instead when you need a specific order.' },
      },
    },
  },
  {
    name: 'plc_start',
    description: 'Start the loaded PLC program.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'plc_stop',
    description: 'Stop the running PLC program.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'plc_status',
    description: 'Get current PLC runtime status: EMPTY | INIT | RUNNING | STOPPED | ERROR.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'plc_getLogs',
    description: 'Get PLC runtime logs. Returns last N lines, hasRuntimeErrors flag, and lastLine.',
    inputSchema: {
      type: 'object' as const,
      properties: { lines: { type: 'number', description: 'Number of recent lines to return (default 50)' } },
    },
  },
  {
    name: 'plc_readVariables',
    description: 'Read runtime variable values via WebSocket debug protocol. Requires a prior plc_compile or plc_buildAndRun (resolves names via that variableMap). Names are case-insensitive-matched; FB outputs use "instance.port" (e.g. timer1.q). Unresolved names come back with nameSuggestions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        varNames: { type: 'array', items: { type: 'string' }, description: 'Variable names to read. Omit for all.' },
        timeoutMs: { type: 'number', description: 'WebSocket timeout ms (default 5000)' },
      },
    },
  },
  {
    name: 'plc_trace',
    description: 'Sample variables over time to verify the SHAPE of temporal behavior (timer progression, state-machine rotation, counter monotonicity) that a single plc_readVariables snapshot cannot. Requires a prior plc_compile/plc_buildAndRun and a RUNNING PLC. Returns a time-series of samples, each with elapsedMs and the runtime tick (advances per scan cycle), plus actualIntervalMs (achieved resolution — each sample is a full debug round trip, ~50ms floor, so transients shorter than that WILL be missed regardless of intervalMs; for edges/transients use plc_verifyBehavior / plc_forceVariables pulseScans, or fetch the per-scan recording via plc_record).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        varNames: { type: 'array', items: { type: 'string' }, description: 'Variable names to sample. Omit for all.' },
        intervalMs: { type: 'number', description: 'Spacing between samples in ms (default 200).' },
        durationMs: { type: 'number', description: 'Total trace duration in ms (default 2000). Ignored if samples is given.' },
        samples: { type: 'number', description: 'Exact number of samples (overrides durationMs). Clamped to [1, 200].' },
        timeoutMs: { type: 'number', description: 'Per-sample WebSocket timeout ms (default 2000).' },
      },
    },
  },
  {
    name: 'plc_record',
    description:
      'Fetch the PER-SCAN recording (one frame per 20ms scan cycle, captured by the always-on ' +
      'recorder plugin) for the given variables over a tick window. Returns changes-only ' +
      'transitions — exact pulse widths, state-transition order, scan-precise sequences that ' +
      'plc_trace (~50ms poll floor) physically cannot see.\n' +
      'Tool selection: persistent-downstream assertion → plc_verifyBehavior (default); ' +
      'inject at an instant / clean edges → plc_forceVariables {when}/{pulseScans}; ' +
      'scan-level sequence EVIDENCE → plc_record (pair fromTick with when.tickAtMet or pulse.startTick); ' +
      'second-scale trends → plc_trace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        varNames: { type: 'array', items: { type: 'string' }, description: 'REQUIRED. Variables to decode (case-insensitive; FB ports as "instance.port").' },
        fromTick: { type: 'number', description: 'Window start tick. Pair with when.tickAtMet-5 or pulse.startTick-5 for edge context.' },
        lastScans: { type: 'number', description: 'Most recent N scan cycles (default 250; auto ×decimation when the recorder decimates). Ignored if fromTick given.' },
        timeoutMs: { type: 'number' },
      },
      required: ['varNames'],
    },
  },
  {
    name: 'plc_waitFor',
    description: 'Wait until a single variable satisfies a comparison, or until timeout. Requires a prior plc_compile/plc_buildAndRun and a RUNNING PLC. Polls the variable every intervalMs; returns when met (success=true) or timedOut=true. Use instead of hand-rolled poll loops. NOTE: to FORCE something the moment a condition holds, do NOT chain waitFor→forceVariables (loses 3-5 scans) — use plc_forceVariables {when:{...}} which fires atomically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        varName: { type: 'string', description: 'Variable to watch (case-insensitive; FB outputs use "instance.port").' },
        op: { type: 'string', enum: ['==', '!=', '>', '>=', '<', '<='], description: 'Comparison operator.' },
        value: { description: 'Value to compare against (number, boolean, or string).' },
        timeoutMs: { type: 'number', description: 'Total wait budget in ms (default 5000).' },
        intervalMs: { type: 'number', description: 'Poll spacing in ms (default 200).' },
      },
      required: ['varName', 'op', 'value'],
    },
  },
  {
    name: 'plc_forceVariables',
    description: 'Force runtime variable values via DEBUG_SET WebSocket protocol. Requires a prior plc_compile or plc_buildAndRun (resolves names via that variableMap). Used to simulate inputs (e.g. press a button at %IX0.0) so PLC programs that depend on real-world signals can be exercised in simulation. Pass {set: {name: value}} to override; pass {release: [names]} to clear the override. Affects the same variables addressable by plc_readVariables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        set: {
          type: 'object',
          description: 'Map of variable name → value to force. Example: {"start_button": true, "setpoint": 42}.',
          additionalProperties: true,
        },
        release: {
          type: 'array',
          items: { type: 'string' },
          description: 'Variable names whose force should be cleared (variable returns to PLC-computed value).',
        },
        timeoutMs: { type: 'number', description: 'WebSocket timeout per variable, ms (default 5000)' },
        pulseMs: { type: 'number', description: 'Auto-release all set variables after this many ms (wall-clock pulse). Prefer pulseScans: a wall-clock pulse cannot prove the program ever scanned the value (too short → zero scan boundaries → no edge produced, silently). Omit or 0 for persistent force (default).' },
        pulseScans: { type: 'number', description: 'Tick-VERIFIED minimal pulse: hold the force until the runtime tick has advanced ≥ this many scan cycles, then auto-release. Result carries pulse:{startTick,releaseTick,scansHeld,verified} as proof the program scanned the value. FIRST CHOICE for edge/R_TRIG testing and edge-counting (call N times for N clean edges). Takes priority over pulseMs. Clamped [1,50].' },
        when: {
          type: 'object',
          description: 'Condition-triggered force: poll {varName op value} and fire the force THE MOMENT it holds, over one persistent debug socket (force lands ~1 scan after the condition — see result.when.gapScans). USE THIS instead of the racy waitFor→forceVariables sequence (its two round trips lose 3-5 scans, e.g. "force the sensor when part_pos==20" keeps missing). Composes with pulseScans. On timeout NO force is applied (success:false).',
          properties: {
            varName: { type: 'string' },
            op: { type: 'string', enum: ['==', '!=', '>', '>=', '<', '<='] },
            value: { description: 'number | boolean | string' },
            timeoutMs: { type: 'number', description: 'Condition wait budget, default 5000.' },
            pollMs: { type: 'number', description: 'Extra delay between polls, default 0 (back-to-back).' },
          },
          required: ['varName', 'op', 'value'],
        },
      },
    },
  },
  {
    name: 'plc_verifyBehavior',
    description:
      'Atomically verify a behavior: force input(s) → wait for a downstream condition within a timeout → auto-release. Requires a prior plc_compile/plc_buildAndRun and a RUNNING PLC.\n\nWHY use this instead of force+read: an edge/fast transient lives for ~1 scan cycle (20ms) and the force→read round-trip (40–300ms + force-takes-effect-next-cycle latency) ALWAYS misses it. The only reliable verification is to assert the persistent DOWNSTREAM effect (a pusher latches, a counter increments, a lamp turns on). This tool\'s shape forces you to name that downstream condition — there is no "snapshot the transient" path because that path does not work.\n\nScope: works for latch / level-holding downstream effects (the common case). For edge-COUNT downstream a held force is only ONE edge — use ST self-drive or plc_trace instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        set: {
          type: 'object',
          description: 'Input variable(s) to force and hold during the wait. Example: {"start_button": true, "sensor_a": true}.',
          additionalProperties: true,
        },
        expect: {
          description: 'The downstream condition(s) to wait for. Single object or array (all must match).',
          oneOf: [
            {
              type: 'object',
              properties: {
                varName: { type: 'string', description: 'Downstream variable to watch (case-insensitive; FB outputs use "instance.port").' },
                op: { type: 'string', enum: ['==', '!=', '>', '>=', '<', '<='], description: 'Comparison operator.' },
                value: { description: 'Value to compare against (number, boolean, or string).' },
                timeoutMs: { type: 'number', description: 'Wait budget per condition, ms (default 5000).' },
                intervalMs: { type: 'number', description: 'Poll spacing, ms (default 200).' },
              },
              required: ['varName', 'op', 'value'],
            },
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  varName: { type: 'string' }, op: { type: 'string', enum: ['==', '!=', '>', '>=', '<', '<='] },
                  value: {}, timeoutMs: { type: 'number' }, intervalMs: { type: 'number' },
                },
                required: ['varName', 'op', 'value'],
              },
              description: 'Array of conditions — ALL must match.',
            },
          ],
        },
        settleMs: { type: 'number', description: 'Wait this long after forcing, before polling begins (default 0).' },
        releaseAfter: { type: 'boolean', description: 'Release the forced inputs when done (default true; avoids contaminating the next verification).' },
      },
      required: ['set', 'expect'],
    },
  },
  {
    name: 'plc_buildSimulation',
    description:
      'Build an animated PROCESS SIMULATION for the running program. Pass {stCode} alone to auto-derive a scene from the located IO (lamps/displays/etc.), or pass {stCode, scene} with an agent-authored Scene Spec. The scene is validated against the program IO; on success scene.json is written and the UI 过程仿真 tab renders it, animated live from PLC values. Use AFTER plc_buildAndRun.\n\nLibrary parts (or kind:"custom" with inline svg for scenarios the library does not cover):\n' +
      PARTS_CATALOG_MD +
      '\n\nEffect 字段速查(bindings[].effect 的合法写法,别自创字段):\n' +
      '- 运动(推荐绝对写法): translateY {type,valueFrom,valueTo,yFrom,yTo} / translateX {…,xFrom,xTo} — xFrom/yFrom = 目标元素(bbox 左/顶边)要到达的绝对坐标(viewBox 单位),工具自动换算为相对位移;高级/遗留:相对 from/to(叠加在绘制位置上,勿与绝对字段混写)\n' +
      '- fill {type,map:[{when:{eq:true},color},{when:{eq:false},color}]}(必须含 on+off) | class {type,map:[{when,className}]}\n' +
      '- text {type,decimals?,suffix?} | visible {type,when} | width/height/opacity {type,valueFrom,valueTo,from,to} | rotate {type,degPerUnit?}\n',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stCode: { type: 'string', description: 'IEC 61131-3 ST source. Prefer stPath in the app.' },
        stPath: { type: 'string', description: 'Workspace-relative (or absolute) path to a .st file; read as the source. Preferred over stCode to keep one source of truth.' },
        stPaths: { type: 'array', items: { type: 'string' }, description: 'Multi-file project: workspace-relative .st paths merged (in this order) into one compilation unit. Must contain exactly one PROGRAM + one CONFIGURATION across all files.' },
        projectDir: { type: 'string', description: 'Multi-file project: a workspace-relative dir; its single-level *.st files are merged (alphabetical). Use stPaths instead when you need a specific order.' },
        scene: { type: ['object', 'string'], description: 'Optional Scene Spec ({version:"1", canvas:{width,height}, parts:[...]}). Omit to auto-suggest from IO. Accepted as an object OR a JSON string of one (both parse) — 不要因为是字符串就拒收. For scenes with physical/spatial relationships use a single kind:"custom" part with inline svg, not scattered library parts.', additionalProperties: true },
        scenePath: { type: 'string', description: 'Workspace 相对或绝对路径的 scene JSON 文件;读取后作为 scene。与 scene 互斥,scenePath 优先。大 scene 用它避免内联。' },
        allowUnverified: { type: 'boolean', description: '跳过"先 verify 后出图"版本门。仅当用户在对话中明确要求跳过验证时才允许填 true;被门拒绝不是填 true 的理由——正确做法是先对当前 .st 跑 verify。' },
      },
    },
  },
]

// lite 收面(spec §4):验证类工具从 MCP 物理移除,验证只能经 verify runner——
// 弱模型 assert 失败后滑回 force→read 老路的通道被结构性堵死(评审 P0-1)。
export const LITE_TOOLS = new Set(['plc_status', 'plc_readVariables', 'plc_getLogs', 'plc_detectIO', 'plc_buildSimulation', 'plc_stop'])

// engineless 收面:没有容器引擎(也没有可达的远程 OpenPLC)时仍然成立的工具 ——
// 纯本地解析/生成,既不 docker exec 也不打 REST。其余一律物理移除。
//
// 为什么是移除而不是让它失败:工具还在列表里,agent 就会照常调 plc_compile,拿回一坨
// "docker: command not found",然后把基础设施故障当成自己代码写错 —— 开始猜测性改码、
// 反复重试,烧 token 还把好代码改坏。工具不在列表里,它自然只做写码和讲解。
export const OFFLINE_TOOLS = new Set(['plc_detectIO', 'plc_buildSimulation'])

/** PLC_ENGINE=none 由宿主(如 VSCode 扩展,现独立走 vscode-插件 分支)在探测不到 docker/podman 时注入。 */
export function isEngineless(): boolean { return process.env.PLC_ENGINE === 'none' }

export function filterToolsForLite(lite: boolean, engineless = false) {
  const base = lite ? TOOLS.filter(t => LITE_TOOLS.has(t.name)) : TOOLS
  return engineless ? base.filter(t => OFFLINE_TOOLS.has(t.name)) : base
}
export function isToolAllowed(name: string, lite: boolean, engineless = false) {
  if (engineless && !OFFLINE_TOOLS.has(name)) return false
  return !lite || LITE_TOOLS.has(name)
}

// When a multi-file project was combined, rewrite iec2c error lines (which point
// at the merged unit) back to their source file + local line, additively.
function applyErrorTraceback(cr: { iec2c?: { errors?: Iec2cError[]; warnings?: Iec2cError[] } }, combine: CombineResult): void {
  for (const bucket of [cr.iec2c?.errors, cr.iec2c?.warnings]) {
    if (!Array.isArray(bucket)) continue
    for (const e of bucket) {
      const t = translateErrorLine(e.line, combine.spans)
      if (t) { e.sourceFile = t.path; e.localLine = t.localLine }
    }
  }
}

export async function startMcpServer(opts: { lite?: boolean } = {}): Promise<void> {
  const cfg = loadConfig()
  // 进程生命周期内固定:env 由扩展在 spawn 时给定,用户装好 docker 后是重启 server 生效。
  const engineless = isEngineless()
  const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
  const server = new Server(
    { name: 'plc-tools', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: filterToolsForLite(!!opts.lite, engineless) }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const input = (args ?? {}) as Record<string, unknown>

    // 兜底(工具已不在 list 里,理论上调不到;历史对话里的旧工具名会走到这)。文案是写给
    // 模型看的:必须明说「不是代码问题、重试无用」,否则它会把这当编译失败去改 ST。
    if (engineless && !OFFLINE_TOOLS.has(name)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false,
        errorMessage: `${name} 在本机不可用:未检测到容器引擎(Docker / Podman),PLC 的编译、运行与验证已整体停用。` +
          `这不是 ST 代码的问题 —— 重试、改代码、换参数都不会让它可用。请直接告诉用户:` +
          `安装并启动 Docker Desktop / Podman,或把设置 semaplc.plcUrl 指向一台远程 OpenPLC。` +
          `在此之前你仍然可以写码、讲解、画梯形图,以及使用 plc_detectIO / plc_buildSimulation。` }) }] }
    }

    if (!isToolAllowed(name, !!opts.lite)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false,
        errorMessage: `${name} 在本环境不可直接调用。验证请写 plan.json 并运行 verify(见 plan-schema.md);单步快查用 plc_status/plc_readVariables。` }) }] }
    }

    let result: unknown

    switch (name) {
      case 'plc_compile': {
        const r = resolveProject({ stCode: input.stCode as string | undefined, stPath: input.stPath as string | undefined, stPaths: input.stPaths as string[] | undefined, projectDir: input.projectDir as string | undefined }, cfg)
        if (r.error || r.stCode == null) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, failedStage: null, errorSummary: r.error ?? 'stCode/stPath/stPaths/projectDir required' }) }] }
        }
        const cr = await handleCompile({ stCode: r.stCode }, cfg)
        if (r.combine) applyErrorTraceback(cr, r.combine)
        result = cr
        break
      }
      case 'plc_upload':
        result = await handleUpload({} as Record<string, never>, cfg)
        break
      case 'plc_buildAndRun': {
        const r = resolveProject({ stCode: input.stCode as string | undefined, stPath: input.stPath as string | undefined, stPaths: input.stPaths as string[] | undefined, projectDir: input.projectDir as string | undefined }, cfg)
        if (r.error || r.stCode == null) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, failedStage: null, agentSummary: r.error ?? 'stCode/stPath/stPaths/projectDir required' }) }] }
        }
        const br = await handleBuildAndRun({ stCode: r.stCode }, {
          compile: (i) => handleCompile(i, cfg),
          upload: () => handleUpload({} as Record<string, never>, cfg),
          start: () => handleStart(client),
        })
        if (r.combine && br.compile) applyErrorTraceback(br.compile, r.combine)
        result = br
        break
      }
      case 'plc_start':
        result = await handleStart(client)
        break
      case 'plc_stop':
        result = await handleStop(client)
        break
      case 'plc_status':
        result = await handleStatus(client)
        break
      case 'plc_getLogs':
        result = await handleGetLogs({ lines: input.lines as number | undefined }, client)
        break
      case 'plc_readVariables':
        result = await handleReadVariables({ varNames: input.varNames as string[] | undefined, timeoutMs: input.timeoutMs as number | undefined }, cfg)
        break
      case 'plc_trace': {
        const traceInput = input as unknown as TraceInput
        result = await handleTrace(traceInput, cfg)
        break
      }
      case 'plc_record': {
        result = await handleRecord(input as unknown as RecordInput, cfg)
        break
      }
      case 'plc_waitFor': {
        const waitInput = input as unknown as WaitForInput
        result = await handleWaitFor(waitInput, cfg)
        break
      }
      case 'plc_forceVariables': {
        const forceInput = input as unknown as ForceVariablesInput
        result = await handleForceVariables(forceInput, cfg)
        break
      }
      case 'plc_verifyBehavior': {
        const verifyInput = input as unknown as VerifyBehaviorInput
        result = await handleVerifyBehavior(verifyInput, cfg)
        break
      }
      case 'plc_check': {
        const r = resolveStInput({ stCode: input.stCode as string | undefined, stPath: input.stPath as string | undefined }, cfg)
        if (r.error || r.stCode == null) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, errors: [], raw: '', errorMessage: r.error ?? 'stCode/stPath required' }) }] }
        }
        result = await handleCheck({ stCode: r.stCode }, cfg)
        if (r.bothGiven) result = { ...(result as object), hint: ST_INPUT_HINT }
        break
      }
      case 'plc_detectIO': {
        const r = resolveProject({ stCode: input.stCode as string | undefined, stPath: input.stPath as string | undefined, stPaths: input.stPaths as string[] | undefined, projectDir: input.projectDir as string | undefined }, cfg)
        if (r.error || r.stCode == null) {
          return { content: [{ type: 'text', text: JSON.stringify({ io: [], count: 0, errorMessage: r.error ?? 'stCode/stPath/stPaths/projectDir required' }) }] }
        }
        result = detectIO(r.stCode)
        break
      }
      case 'plc_buildSimulation': {
        const r = resolveProject({ stCode: input.stCode as string | undefined, stPath: input.stPath as string | undefined, stPaths: input.stPaths as string[] | undefined, projectDir: input.projectDir as string | undefined }, cfg)
        if (r.error || r.stCode == null) {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, errors: [r.error ?? 'stCode/stPath/stPaths/projectDir required'] }) }] }
        }
        let scene = input.scene as any
        if (typeof input.scenePath === 'string' && input.scenePath.trim() !== '') {
          const sr = resolveScene(input.scenePath, cfg)
          if (sr.error) {
            return { content: [{ type: 'text', text: JSON.stringify({ ok: false, errors: [sr.error] }) }] }
          }
          scene = sr.scene  // scenePath wins over inline scene
        }
        const latestFile = cfg.workspace ? path.join(cfg.workspace, '.plc-act', 'latest.json') : null
        const verifyGate = latestFile ? { latestFile, stHash: stHashOf(r.stCode) } : undefined
        result = await handleBuildSimulation(
          { stCode: r.stCode, scene, allowUnverified: input.allowUnverified === true },
          { sceneFile: cfg.sceneFile, ioMapFile: cfg.ioMapFile, verifyGate },
        )
        break
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[plc-tools] MCP server ready\n')
}
