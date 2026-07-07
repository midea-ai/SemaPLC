import { SemaCore } from 'sema-core'
import { bus } from './event-bus.js'
import { setupWorkspaceIfNeeded, scanStFiles, scanProjectFiles, isProjectFile, readStFile, writeStFile } from './workspace-setup.js'
import { readPlcState, plcStateFileForWorkspace } from './state-reader.js'
import { BlockMapper } from './block-mapper.js'
import { validateSceneSpec } from '../../sema-plc-tools/dist/tools/sceneSpec.js'
import * as fs from 'fs'
import * as path from 'path'
import { safePath } from './pathSafety.js'
import { currentModelConfigState, resolveModel, setRuntimeModelKey, getRuntimeThinking, setRuntimeThinking, VERIFIED_MODEL_KEYS, envKeyForModel, buildModelRegistry } from './model-registry.js'
import { addCustomModel, deleteCustomModel, getCustomModel } from './custom-models.js'
import { saveKeyOverride } from './key-overrides.js'

const COMPILED_ST_REL = 'src/programs/_running.st'  // transient mirror for inline-stCode builds; self-cleaned once a real .st covers it

export class SemaBridge {
  private core: SemaCore | null = null
  // sema-core 2.0.5: session-level API (processUserInput / interrupt / on / dispose /
  // respondTo*) moved from SemaCore onto the SemaSession returned by createSession().
  private session: any = null
  private workspace: string
  private sessionId: string | null = null
  private currentStPath: string | null = null
  private busOff: (() => void) | null = null
  private watcher: fs.FSWatcher | null = null
  private rescanTimer: NodeJS.Timeout | null = null
  // Polling fallback for fs.watch: fs.watch({recursive:true}) silently never fires on
  // some platforms (confirmed broken on Node 26 / macOS), which would freeze the code
  // panel since the editor only updates off editor:open. The poll guarantees live updates.
  private pollTimer: NodeJS.Timeout | null = null
  // Track last-known state per file to debounce duplicate emits.
  // null = "have not scanned yet" (initial state) — first scan always emits.
  private lastFilesSignature: string | null = null
  // mtime of config/scene.json at the last scene:ready emit — re-emit only when it changes
  // (so calling emitSceneIfPresent from the file watcher is a cheap no-op when unchanged).
  private lastSceneMtime = 0
  // mtime of .plc-vis/state.json at the last refreshVariableMap call.
  // CodeAct runner 经 CLI 直写 state.json(不经 MCP 工具事件)——mtime 变化即触发刷新,
  // 保证 Vars 面板/梯图着色在 CodeAct 路径下不掉链(spec §4 兜底)。
  private lastStateMtime = 0
  // Per-turn plan scoping. sema-core never resets its todo list between user turns: every
  // 'todos:update' carries the FULL session-wide list (completed-first). To make the plan
  // card show only the CURRENT turn, we freeze a watermark = max todo id seen so far at each
  // idle→processing edge (a genuine new turn — startQuery; inject stays 'processing' and emits
  // no state:update), then forward only todos with id > watermark. The watermark lives here in
  // the single backend instance (sticky-replayed to all tabs/late-joiners), so it stays correct
  // across reconnects/multi-tab — unlike a per-client React baseline.
  private todoMaxIdSeen = 0
  private todoWatermark = 0
  // Maps sema-core session events → block-protocol ServerMessages (agent:turn-*/agent:block-*).
  // Re-created in wireEvents() on every start(), so it resets with the session.
  private mapper: BlockMapper | null = null

  constructor(initialWorkspace: string) {
    this.workspace = initialWorkspace
  }

  async start(): Promise<void> {
    setupWorkspaceIfNeeded(this.workspace)

    this.core = new SemaCore({
      workingDir: this.workspace,
      logLevel: 'warn',
      // 块协议消费 message:thinking:chunk；DeepSeek(openai adapter reasoning_content)/MiniMax(anthropic adapter) 逐 provider 实测。
      // 默认开(保留对话页思考块);PLC_THINKING=0 关闭——思考会烧掉输出 token 预算,撞 maxTokens 触发截断红框时可关闭对比。
      // SemaCore 构造期读取,start() 在 resetSession/switchWorkspace 都会重建 core,故改 env 重启即生效。
      thinking: getRuntimeThinking(),
      stream: true,
      disableTopicDetection: true,
      disableBackgroundTasks: true,
      // sema-core has FIVE independent skip flags for tool-permission classes
      // (see W2/LESSONS_LEARNED.md 2026-05-21). Missing any one will cause the
      // session to silently hang when the LLM first hits that class — the
      // PermissionManager emits 'tool:permission:request' and awaits a
      // response forever. We don't have a UI permission flow yet (Phase 2),
      // so skip all five. The tool:permission:request defensive listener
      // below catches any future class sema-core might add.
      skipMCPToolPermission: true,
      skipFileEditPermission: true,
      skipShellExecPermission: true,
      skipSkillPermission: true,
      skipFetchUrlPermission: true,
      // ask_form (askUserQuestion) bypasses PermissionManager entirely — it
      // emits pick:option:request and awaits pick:option:response. No skip
      // flag covers it; we have to disable the tool itself so the model
      // doesn't call it.
      disabledTools: ['ask_form'],
    } as any)

    // Register + select the LLM model before the session starts (mirrors run-demo).
    // skipValidation=true: high-latency endpoints can spuriously fail the short
    // startup connectivity probe; real request failures still surface at generation.
    const model = resolveModel(process.env, (level, message) => {
      bus.emit({ type: 'log', ts: Date.now(), source: 'system', level, message })
    })
    if (model) await this.applyModel(model)
    this.emitModelConfig()

    // sema-core 2.0.5: createSession() resolves to { ok, session }; the session-level
    // API + events live on the returned SemaSession — wire events AFTER it exists.
    const created = await (this.core!.createSession() as Promise<any>)
    if (!created.ok) throw new Error(`createSession failed: ${created.error}`)
    this.session = created.session
    this.sessionId = created.session.sessionId

    // core.dispose() clears the RuleManager/MemoryManager singleton CACHES but the
    // singletons survive, and re-creating SemaCore never reloads them (the background
    // load only runs in the singleton constructor, once per process). Without this
    // forced reload, AGENTS.md/MEMORY.md silently vanish from every prompt after
    // resetSession() — the agent loses all domain rules (e.g. write code to
    // src/programs/). After createSession() the config (incl. initialCwd) is applied,
    // so this is a safe point; on first start it's an idempotent re-read.
    await (this.core as any).getRuleInfo(true)
    await (this.core as any).getMemoryInfo(true)

    this.wireEvents()

    // Hydrate state
    bus.emit({ type: 'workspace:ready', path: this.workspace, sessionId: this.sessionId! })
    const state = readPlcState(plcStateFileForWorkspace(this.workspace))
    bus.emit({ type: 'plc:state', status: state.hasState ? 'STOPPED' : 'EMPTY' })
    bus.emit({ type: 'plc:variables', map: state.variableMap })

    // Initial ST file scan
    this.rescanAndEmit({ openNewest: true })
    // Re-publish a scene.json left from a previous run so the 过程仿真 tab is populated on reload.
    this.emitSceneIfPresent({ force: true })

    // Watch workspace for .st file changes (Agent Write tool, manual fs edits, etc.)
    this.startFileWatcher()

    // Subscribe to internal bus commands. Save the unsubscribe handle so
    // switchWorkspace() can detach before re-subscribing on restart.
    this.busOff?.()
    this.busOff = bus.on((m) => this.handleInternal(m).catch((e) => {
      bus.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }))
  }

  private wireEvents(): void {
    if (!this.session) return
    // Fresh session per start() — reset per-turn plan watermark.
    this.todoMaxIdSeen = 0
    this.todoWatermark = 0
    this.mapper = new BlockMapper((m) => bus.emit(m))
    const mp = this.mapper
    this.session.on('message:thinking:chunk', (d: { id: string; delta?: string }) => {
      if (d.delta) mp.onThinkingChunk({ id: d.id, delta: d.delta })
    })
    this.session.on('message:text:chunk', (d: { id: string; delta?: string }) => {
      if (d.delta) {
        mp.onTextChunk({ id: d.id, delta: d.delta })
      }
    })
    this.session.on('message:complete', (d: { id: string; agentId: string; reasoning: string; content: string; hasToolCalls: boolean }) => {
      mp.onMessageComplete(d)
    })
    this.session.on('tool:execution:start', (d: { agentId: string; toolId: string; toolName: string; input: Record<string, unknown> }) => {
      mp.onToolStart(d)
    })
    this.session.on('tool:execution:chunk', (d: { agentId: string; toolId: string; toolName: string; content: unknown }) => {
      mp.onToolChunk(d)
    })
    // sema-core StateManager emits 'todos:update' (TodoItem[]) — the FULL accumulated list.
    // Track the max id and forward only the current turn's todos (id > watermark) to the plan card.
    ;(this.session as any).on('todos:update', (todos: import('../shared/protocol.js').TodoItem[]) => {
      for (const t of todos) {
        const n = parseInt(t.id, 10)
        if (Number.isFinite(n) && n > this.todoMaxIdSeen) this.todoMaxIdSeen = n
      }
      const current = todos.filter((t) => {
        const n = parseInt(t.id, 10)
        return Number.isFinite(n) ? n > this.todoWatermark : true
      })
      bus.emit({ type: 'agent:todos', todos: current })
    })
    this.session.on('state:update', (d: { state: string }) => {
      if (d.state === 'idle') {
        this.mapper?.onIdle()   // 兜底封口（排队批次不经过 idle，正常封口在 hasToolCalls=false）
        bus.emit({ type: 'agent:state', state: 'idle' })
      } else {
        // idle→processing edge = genuine new turn (startQuery). Freeze the watermark so the
        // next turn's plan card starts clean; inject emits no state:update so it won't fire here.
        this.todoWatermark = this.todoMaxIdSeen
        bus.emit({ type: 'agent:state', state: 'processing' })
      }
    })
    this.session.on('tool:execution:complete', (d: { agentId: string; toolId: string; toolName: string; title?: string; content?: unknown }) => {
      mp.onToolComplete(d as Parameters<typeof mp.onToolComplete>[0])
      // No emitLog 'info' here — frontend logs.ts derives a cleaner short-name entry
      // from agent:tool-complete (avoids duplicate "mcp__plc-tools__plc_status ✓" lines).
      // Path B: LLM called plc_buildAndRun with inline stCode → state.json has the source
      // but no .st file exists in the workspace. Mirror it to src/programs/_running.st so the editor +
      // ladder canvas have something to show.
      // Tool names from MCP have the form 'mcp__<server>__<tool>' — match on suffix.
      const toolName = d.toolName ?? ''
      if (toolName.endsWith('plc_buildAndRun') || toolName.endsWith('plc_compile')) {
        this.mirrorCompiledStToFile()
        // state.json.variableMap was rewritten by the compile — push the fresh
        // map to clients so the Vars panel reflects the new program's variables
        // (otherwise it keeps showing the previous compile's symbols).
        this.refreshVariableMap()
      }
      if (toolName.endsWith('plc_buildSimulation')) {
        this.emitSceneIfPresent()
      }
      // Agent file-edit tools (write_file/patch_file/edit/…): trigger a rescan directly
      // off tool completion so the code panel updates the instant the Agent writes ST —
      // fs.watch is unreliable (broken for recursive watch on this Node/macOS), so we
      // can't depend on it. plc_* tools are handled above; exclude them here.
      if (!toolName.includes('plc_') &&
          /write_file|patch_file|edit_file|str_replace|apply_patch|create_file|multi_edit|run_shell/i.test(toolName)) {
        this.scheduleRescan()
      }
    })
    this.session.on('tool:execution:error', (d: { agentId: string; toolId: string; toolName: string; title?: string; content?: string; input?: unknown }) => {
      mp.onToolError(d as Parameters<typeof mp.onToolError>[0])
    })
    this.session.on('session:error', (d: unknown) => {
      const event = d as {
        message?: string
        error?: { code?: string; message?: string; details?: { status?: number; requestID?: string | null } }
      }
      const details = event.error?.details
      const suffix = [
        event.error?.code,
        details?.status ? `status ${details.status}` : undefined,
        details?.requestID ? `request ${details.requestID}` : undefined,
      ].filter(Boolean).join(', ')
      const message = event.message
        ?? event.error?.message
        ?? (typeof d === 'string' ? d : JSON.stringify(d))
      bus.emit({ type: 'error', message: suffix ? `${message} (${suffix})` : message })
    })
    this.session.on('session:interrupted', () => {
      this.mapper?.onInterrupted()
    })

    // Defensive: if a permission request slips through (e.g. sema-core adds a
    // new permission class we haven't accounted for), auto-agree so the
    // session doesn't hang. Surface as a warning log so we can spot it.
    ;(this.session as any).on('tool:permission:request', (req: any) => {
      this.emitLog('agent', 'warn',
        `unexpected tool permission request for "${req.toolName ?? '?'}" — auto-agreeing. ` +
        `If this fires often, check skip*Permission flags in sema-bridge.`)
      try {
        ;(this.session as any).respondToToolPermission({ toolId: req.toolId, selected: 'agree' })
      } catch (e) {
        bus.emit({ type: 'error', message: `failed to auto-agree permission: ${e}` })
      }
    })

    // Same defense for the pick:option flow used by ask_form / pick_option.
    // disabledTools should prevent these being called, but if a future model
    // tool slips through, auto-cancel so we don't hang.
    ;(this.session as any).on('pick:option:request', (req: any) => {
      this.emitLog('agent', 'warn',
        `unexpected pick:option request — auto-cancelling. Check disabledTools.`)
      try {
        ;(this.session as any).respondToPickOption({ requestId: req.requestId ?? req.id, selected: null })
      } catch (e) {
        bus.emit({ type: 'error', message: `failed to auto-cancel pick:option: ${e}` })
      }
    })
  }

  private async handleInternal(m: import('./event-bus.js').BusMessage): Promise<void> {
    if (!('type' in m)) return
    switch (m.type) {
      case 'internal:user-input':
        bus.emit({ type: 'agent:user-input-received', text: m.text })
        this.session?.processUserInput(m.text)
        break
      case 'internal:agent-interrupt':
        this.session?.interrupt()
        break
      case 'internal:client-connected': {
        // 新客户端（新 tab/断线重连）——重放当前 streaming turn 的块快照。
        // 广播给所有客户端：快照与块事件在 bus 上天然串行，已在流中的客户端
        // 应用快照是幂等替换（内容一致）。无开放 turn 时发 null（no-op）。
        bus.emit({ type: 'agent:turn-snapshot', turn: this.mapper?.snapshot() ?? null })
        break
      }
      case 'internal:editor-save': {
        const target = m.path
          ? path.resolve(this.workspace, m.path)
          : (this.currentStPath ?? path.join(this.workspace, 'current.st'))
        if (!target.startsWith(this.workspace)) {
          bus.emit({ type: 'error', message: `editor:save path outside workspace: ${m.path}` })
          break
        }
        try {
          writeStFile(target, m.stCode)
          this.currentStPath = target
          bus.emit({ type: 'editor:saved', path: path.relative(this.workspace, target), content: m.stCode })
        } catch (e) {
          bus.emit({ type: 'error', message: `保存失败: ${path.relative(this.workspace, target)} — ${e instanceof Error ? e.message : String(e)}` })
        }
        break
      }
      case 'internal:editor-open': {
        // Client wants to switch to a different .st file
        const target = path.resolve(this.workspace, m.path)
        // Guard: must stay inside workspace
        if (!target.startsWith(this.workspace)) {
          bus.emit({ type: 'error', message: `editor:open path outside workspace: ${m.path}` })
          break
        }
        if (!fs.existsSync(safePath(target, this.workspace))) {
          bus.emit({ type: 'error', message: `editor:open file not found: ${m.path}` })
          break
        }
        this.currentStPath = target
        bus.emit({ type: 'editor:open', path: path.relative(this.workspace, target), content: readStFile(target) })
        break
      }
      case 'internal:workspace-switch':
        await this.switchWorkspace(m.path)
        break
      case 'internal:session-reset':
        await this.resetSession()
        break
      case 'internal:model-switch': {
        if (!(VERIFIED_MODEL_KEYS as readonly string[]).includes(m.key) && !getCustomModel(m.key)) {
          bus.emit({ type: 'error', message: `model '${m.key}' is not verified yet` })
          break
        }
        const before = currentModelConfigState().selected
        setRuntimeModelKey(m.key)
        const model = resolveModel(process.env, (level, message) => {
          bus.emit({ type: 'log', ts: Date.now(), source: 'system', level, message })
        })
        if (!model) {
          setRuntimeModelKey(before)
          this.emitModelConfig()
          break
        }
        try {
          await this.applyModel(model)
          this.emitModelConfig()
        } catch (e) {
          setRuntimeModelKey(before)
          this.emitModelConfig()
          bus.emit({ type: 'error', message: `model switch failed: ${e instanceof Error ? e.message : String(e)}` })
        }
        break
      }
      case 'internal:set-thinking': {
        try {
          if (!this.core) return
          this.core.updateCoreConfig({ thinking: m.enabled })
          setRuntimeThinking(m.enabled)
          this.emitModelConfig()
        } catch (e) {
          bus.emit({ type: 'error', message: `set thinking failed: ${e instanceof Error ? e.message : String(e)}` })
        }
        break
      }
      case 'internal:custom-add': {
        // 追加一条自定义模型到列表(custom-models.json 持久化),并切换过去。
        const before = currentModelConfigState().selected
        const entry = addCustomModel({ baseURL: m.baseURL, apiKey: m.apiKey, modelName: m.modelName, adapt: m.adapt })
        bus.emit({ type: 'log', ts: Date.now(), source: 'system', level: 'info', message: `custom model added: ${entry.modelName} @ ${entry.baseURL}` })
        setRuntimeModelKey(entry.id)
        const model = resolveModel(process.env, (level, message) => {
          bus.emit({ type: 'log', ts: Date.now(), source: 'system', level, message })
        })
        if (!model) {
          setRuntimeModelKey(before)
          this.emitModelConfig()
          break
        }
        try {
          await this.applyModel(model)
          this.emitModelConfig()
        } catch (e) {
          setRuntimeModelKey(before)
          this.emitModelConfig()
          bus.emit({ type: 'error', message: `custom model switch failed: ${e instanceof Error ? e.message : String(e)}` })
        }
        break
      }
      case 'internal:custom-delete': {
        // 从列表删除;若删的是当前项,回退到第一个已配置的已验证模型。
        const wasSelected = currentModelConfigState().selected === m.id
        deleteCustomModel(m.id)
        bus.emit({ type: 'log', ts: Date.now(), source: 'system', level: 'info', message: `custom model deleted: ${m.id}` })
        if (wasSelected) {
          const fallback = currentModelConfigState().options.find((o) => o.configured && !o.key.startsWith('custom'))?.key ?? null
          setRuntimeModelKey(fallback)
          const model = resolveModel(process.env, (level, message) => {
            bus.emit({ type: 'log', ts: Date.now(), source: 'system', level, message })
          })
          if (model) {
            try { await this.applyModel(model) } catch (e) {
              bus.emit({ type: 'error', message: `fallback model failed: ${e instanceof Error ? e.message : String(e)}` })
            }
          }
        }
        this.emitModelConfig()
        break
      }
      case 'internal:set-key': {
        // 给未配置的内置模型填 API key:定位其 *_API_KEY 环境变量名,持久化 + 即时写
        // process.env,然后重算并下发 model:config(徽标从「未配置」翻为已配置)。
        // 不自动切换——用户随后点亮起来的行即可切过去。
        const envKey = envKeyForModel(m.key)
        if (!envKey) {
          bus.emit({ type: 'error', message: `model '${m.key}' 没有可填 key 的环境变量槽` })
          break
        }
        const val = m.apiKey.trim()
        if (!val) {
          bus.emit({ type: 'error', message: 'API key 不能为空' })
          break
        }
        // 先探针校验链路:用刚填的 key + 该模型的 baseURL/modelName/adapt 发一个短请求
        // (SemaCore testApiConnection 让模型回 "YES"),通了才落盘。探针独立于会话模型,
        // 不影响当前 active。测不过就不保存,把原因 + curl 调试命令回给弹窗。
        // 例外:force=true 时跳过探针直接保存——探针的 URL 规整(apiUtil.buildApiUrl)与
        // 运行时(openai.js)并不完全一致,可能误报失败,故给用户「仍然保存」的越过口子。
        const cfg = buildModelRegistry(process.env)[m.key]
        if (!m.force && this.core && cfg) {
          let result: { success: boolean; message: string; curlCommand?: string }
          try {
            result = await (this.core as any).testApiConnection({
              provider: cfg.provider,
              baseURL: cfg.baseURL,
              modelName: cfg.modelName,
              apiKey: val,
              adapt: cfg.adapt,
            })
          } catch (e) {
            result = { success: false, message: e instanceof Error ? e.message : String(e) }
          }
          if (!result.success) {
            bus.emit({ type: 'model:key-result', key: m.key, ok: false, message: result.message, curl: result.curlCommand })
            break
          }
        }
        // 校验通过(或极端情况下 core 未就绪的兜底):落盘 + 若正是当前选中模型则激活。
        saveKeyOverride(envKey, val)
        bus.emit({ type: 'log', ts: Date.now(), source: 'system', level: 'info', message: `API key saved for ${m.key} (${envKey})` })
        // 若刚填 key 的模型正是当前会被选中的那个(典型:启动 PLC_MODEL 指定但缺 key),
        // 顺带 applyModel 让 SemaCore 真正加载它——否则 model:config 会算出 active 非 null,
        // 前端显示「已激活」但对话实际不可用(SemaCore 没注册过任何模型)。
        const model = resolveModel(process.env, (level, message) => {
          bus.emit({ type: 'log', ts: Date.now(), source: 'system', level, message })
        })
        if (model && model.selected === m.key) {
          try {
            await this.applyModel(model)
          } catch (e) {
            bus.emit({ type: 'error', message: `模型激活失败: ${e instanceof Error ? e.message : String(e)}` })
          }
        }
        this.emitModelConfig()
        bus.emit({ type: 'model:key-result', key: m.key, ok: true })
        break
      }
      default:
        break
    }
  }

  private emitModelConfig(): void {
    bus.emit({ type: 'model:config', config: currentModelConfigState() })
  }

  private async applyModel(model: NonNullable<ReturnType<typeof resolveModel>>): Promise<void> {
    if (!this.core) throw new Error('SemaCore is not initialized')
    await (this.core as any).addModel(model.cfg, true)
    await (this.core as any).applyTaskModel({ main: model.id, quick: model.id })
    bus.emit({ type: 'log', ts: Date.now(), source: 'system', level: 'info', message: `model: ${model.id}` })
  }

  private startFileWatcher(): void {
    try {
      this.watcher?.close()
    } catch {}
    try {
      this.watcher = fs.watch(safePath(this.workspace), { recursive: true }, (_event, filename) => {
        if (!filename) return
        const f = filename.toString()
        // Ignore changes inside .sema/ and .plc-vis/ and node_modules
        if (f.startsWith('.sema') || f.startsWith('.plc-vis') || f.includes('node_modules')) return
        if (!isProjectFile(f)) return
        this.scheduleRescan()
      })
    } catch (e) {
      // fs.watch can fail on some filesystems; log but don't crash
      this.emitLog('agent', 'warn', `file watcher unavailable: ${e}`)
    }
    // Polling fallback (fs.watch is unreliable — see pollTimer comment). rescanAndEmit
    // is a cheap no-op when nothing changed (it diffs lastFilesSignature + the open
    // file's mtime), so a 1s poll catches Agent/manual edits fs.watch misses.
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => this.rescanAndEmit({ openNewest: !this.currentStPath }), 1000)
  }

  private scheduleRescan(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null
      this.rescanAndEmit({ openNewest: !this.currentStPath })
    }, 150)
  }

  /**
   * Re-scan ST files. Always emits editor:files (so the file-picker UI stays current).
   * Emits editor:open in two cases:
   *  - openNewest=true (typically initial scan / no file open yet): pick the newest .st
   *  - currentStPath's mtime changed: re-emit its content (Agent rewrote the file we have open)
   */
  private rescanAndEmit(opts: { openNewest: boolean }): void {
    // Self-clean the transient mirror: if another .st now holds the same source
    // (the agent wrote a real named file), drop src/programs/_running.st so the
    // workspace never carries a duplicate of the running program.
    try {
      const mirrorAbs = safePath(path.join(this.workspace, COMPILED_ST_REL), this.workspace)
      if (fs.existsSync(mirrorAbs)) {
        const mirrorSrc = readStFile(mirrorAbs)
        const dupe = scanStFiles(this.workspace).some(f =>
          f.path !== mirrorAbs && (() => { try { return readStFile(f.path) === mirrorSrc } catch { return false } })())
        if (dupe) {
          fs.unlinkSync(mirrorAbs)
          if (this.currentStPath === mirrorAbs) this.currentStPath = null
        }
      }
    } catch {}

    // Tree lists all project files (ST + config); auto-open/Run still target .st.
    const files = scanProjectFiles(this.workspace).map(f => ({
      path: path.relative(this.workspace, f.path),
      mtime: f.mtime,
    }))
    const sig = files.map(f => `${f.path}:${f.mtime}`).join('|')
    const filesChanged = sig !== this.lastFilesSignature
    this.lastFilesSignature = sig

    if (filesChanged) bus.emit({ type: 'editor:files', files })

    // Re-push the process-sim scene whenever config/scene.json changes — covers
    // both plc_buildSimulation (tool path) AND the agent writing the file directly.
    // The mtime guard makes this a no-op when the scene is unchanged.
    this.emitSceneIfPresent()

    // verify runner 经 CLI 直写 state.json(不经 MCP 工具事件)——mtime 变化即刷新
    // variableMap,保证 Vars 面板/梯图着色在 CodeAct 路径下不掉链(spec §4 兜底)。
    try {
      const st = fs.statSync(path.join(this.workspace, '.plc-vis', 'state.json')).mtimeMs
      if (st !== this.lastStateMtime) { this.lastStateMtime = st; this.refreshVariableMap() }
    } catch { /* state.json 尚不存在 */ }

    if (files.length === 0) {
      // workspace emptied — close editor
      if (this.currentStPath) {
        this.currentStPath = null
        bus.emit({ type: 'editor:open', path: '', content: '' })
      }
      return
    }

    if (opts.openNewest && !this.currentStPath) {
      // prefer the newest .st so the ladder/Run target real PLC source, not a config file
      const firstSt = files.find(f => f.path.endsWith('.st'))
      if (!firstSt) return  // no ST file yet — keep currentStPath null, don't open a config file
      const newest = path.join(this.workspace, firstSt.path)
      this.currentStPath = newest
      bus.emit({ type: 'editor:open', path: firstSt.path, content: readStFile(newest) })
      return
    }

    // If currently-open file was rewritten (Agent edited it), re-emit its content
    if (this.currentStPath) {
      const relCurrent = path.relative(this.workspace, this.currentStPath)
      const match = files.find(f => f.path === relCurrent)
      if (match) {
        try {
          bus.emit({ type: 'editor:open', path: relCurrent, content: readStFile(this.currentStPath) })
        } catch {}
      } else {
        // The currently-open file was deleted/renamed — switch to the newest .st.
        // NOT files[0]: scanProjectFiles includes config .json (e.g. config/scene_draft.json),
        // and it sorts by mtime-desc, so a freshly-written scene file would land at files[0].
        // Opening that makes editor.stCode a scene JSON → the Run button compiles JSON → fails.
        const firstSt = files.find(f => f.path.endsWith('.st'))
        if (firstSt) {
          this.currentStPath = path.join(this.workspace, firstSt.path)
          bus.emit({ type: 'editor:open', path: firstSt.path, content: readStFile(this.currentStPath) })
        } else {
          this.currentStPath = null
          bus.emit({ type: 'editor:open', path: '', content: '' })
        }
      }
    }
  }

  /**
   * After plc_buildSimulation writes $workspace/scene.json, read it and push the
   * scene to clients. Read-from-file (not the tool result) mirrors how we read
   * state.json — no dependency on sema-core's tool-content shape.
   */
  private emitSceneIfPresent(opts: { force?: boolean } = {}): void {
    try {
      const p = safePath(path.join(this.workspace, 'config', 'scene.json'), this.workspace)
      if (!fs.existsSync(p)) { this.lastSceneMtime = 0; return }
      // Re-emit only when the file actually changed (mtime guard) so the file
      // watcher can call this on every rescan cheaply. force=true bypasses the
      // guard (startup hydration must always (re)emit for late-joining clients).
      const mtime = fs.statSync(p).mtimeMs
      if (!opts.force && mtime === this.lastSceneMtime) return
      const scene = JSON.parse(fs.readFileSync(p, 'utf8'))
      this.lastSceneMtime = mtime
      // Validate at READ time so a scene that bypassed plc_buildSimulation (e.g. written
      // directly via write_file) can't silently render as a dead figure. Surface the same
      // errors the build gate would have raised; the UI shows them above the simulation.
      let sceneErrors: string[] | undefined
      let sceneWarnings: string[] | undefined
      try {
        const state = readPlcState(plcStateFileForWorkspace(this.workspace))
        const names = (state.variableMap ?? []).map((v: { name: string }) => v.name)
        const r = validateSceneSpec(scene, names)
        if (r.errors.length) sceneErrors = r.errors
        if (r.warnings.length) sceneWarnings = r.warnings
      } catch {}
      bus.emit({ type: 'scene:ready', scene, sceneErrors, sceneWarnings })
    } catch (e) {
      this.emitLog('agent', 'warn', `emitScene failed: ${e}`)
    }
  }

  /**
   * Re-read state.json after a fresh compile and re-emit plc:variables. Each
   * successful plc_buildAndRun overwrites lastCompile.variableMap with the new
   * program's symbols; without re-emitting, the frontend's Vars panel still
   * shows the previous program's variables.
   */
  private refreshVariableMap(): void {
    try {
      const state = readPlcState(plcStateFileForWorkspace(this.workspace))
      bus.emit({ type: 'plc:variables', map: state.variableMap })
    } catch (e) {
      this.emitLog('agent', 'warn', `refreshVariableMap failed: ${e}`)
    }
  }

  /**
   * After plc_buildAndRun (or plc_compile), state.json has the source that was just compiled.
   * If no .st file in the workspace matches that source (LLM passed stCode inline), mirror it
   * to $workspace/src/programs/_running.st so the editor + ladder canvas always have something to show.
   * The fs.watch handler then picks up the new file and emits editor:files/open as usual.
   */
  private mirrorCompiledStToFile(): void {
    try {
      const state = readPlcState(plcStateFileForWorkspace(this.workspace))
      if (!state.hasState || !state.stCode) return

      // Check if any existing .st file in the workspace already has this content.
      // If so, skip mirroring to avoid duplicates.
      const files = scanStFiles(this.workspace)
      const alreadyExists = files.some(f => {
        try { return readStFile(f.path) === state.stCode } catch { return false }
      })
      if (alreadyExists) return

      const target = path.join(this.workspace, COMPILED_ST_REL)
      writeStFile(target, state.stCode)
      // fs.watch may not fire reliably for in-process writes on all platforms; trigger rescan explicitly.
      this.scheduleRescan()
    } catch (e) {
      this.emitLog('agent', 'warn', `mirrorCompiledSt failed: ${e}`)
    }
  }

  async resetSession(): Promise<void> {
    // 1. Interrupt agent if processing
    if (this.session) {
      try { this.session.interrupt() } catch {}
      // Wait up to 3s for idle
      await new Promise<void>((resolve) => {
        let settled = false
        const off = bus.on((m) => {
          if ('type' in m && m.type === 'agent:state' && (m as any).state === 'idle') {
            settled = true; off(); resolve()
          }
        })
        setTimeout(() => { if (!settled) { off(); resolve() } }, 3000)
      })
    }

    // 2. Stop PLC if running (best-effort, don't block reset on failure)
    try {
      bus.emit({ type: 'internal:plc-stop' })
      // Give plc-controller a moment to process stop
      await new Promise((r) => setTimeout(r, 500))
    } catch {}

    // 3. Broadcast workspace:switching (clears frontend stores + sticky cache)
    bus.emit({ type: 'workspace:switching' })

    // 4. Tear down current session + core
    try {
      if (this.session) { try { this.core?.closeSession(this.session.sessionId) } catch {}; this.session = null }
      await this.core?.dispose()
    } catch {}

    // 5. Clean up watchers and timers
    try { this.watcher?.close() } catch {}
    this.watcher = null
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.lastFilesSignature = null
    this.lastSceneMtime = 0
    this.lastStateMtime = 0
    this.core = null
    this.mapper = null
    this.sessionId = null
    this.currentStPath = null

    // 6. Clean workspace files and re-init from templates
    const { cleanWorkspace } = await import('./workspace-setup.js')
    cleanWorkspace(this.workspace)

    // 7. Re-start (setupWorkspace + createSession + hydrate + watch)
    await this.start()
  }

  private async switchWorkspace(newPath: string): Promise<void> {
    bus.emit({ type: 'workspace:switching' })
    try {
      if (this.session) { try { this.core?.closeSession(this.session.sessionId) } catch {}; this.session = null }; await this.core?.dispose()
    } catch {}
    try {
      this.watcher?.close()
    } catch {}
    this.watcher = null
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.lastFilesSignature = null
    this.lastStateMtime = 0
    this.core = null
    this.mapper = null
    this.sessionId = null
    this.currentStPath = null
    this.workspace = path.resolve(newPath)
    await this.start()
  }

  private emitLog(source: 'tool' | 'agent' | 'system', level: 'info' | 'warn' | 'error', message: string) {
    bus.emit({ type: 'log', source, level, message, ts: Date.now() })
  }

  getWorkspace(): string { return this.workspace }
  getCurrentStPath(): string | null { return this.currentStPath }
  async dispose(): Promise<void> {
    this.busOff?.()
    this.busOff = null
    try { this.watcher?.close() } catch {}
    this.watcher = null
    if (this.rescanTimer) { clearTimeout(this.rescanTimer); this.rescanTimer = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.session) { try { this.core?.closeSession(this.session.sessionId) } catch {}; this.session = null }; await this.core?.dispose()
  }
}
