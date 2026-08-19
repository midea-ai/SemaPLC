# SemaBridge: Embedded Agent Integration

`server/sema-bridge.ts` is the largest single file in the backend (about 790 lines): it **embeds** the `sema-core` Agent framework inside the web backend process and is responsible for session lifecycle, translating sema-core events into frontend messages, workspace seeding, and live `.st` file sync. It does not hold the WebSocket directly -- all input and output flow through the [event bus](en/wiki/web/realtime).

> `sema-core` is vendored as a tarball at `sema-plc-web/vendor/sema-core-2.0.5.tgz` and installed via `"sema-core": "file:vendor/sema-core-2.0.5.tgz"` in `package.json` -- events such as `tool:execution:start` are required but not yet included in the npm-published version.

## SemaCore / SemaSession Lifecycle

The sequence in `start()` (`sema-bridge.ts:62`):

1. `setupWorkspaceIfNeeded(workspace)` -- workspace seeding (see below)
2. `new SemaCore({...})` -- key constructor parameters:
   - `workingDir: workspace`, `stream: true`, `thinking: getRuntimeThinking()` (`PLC_THINKING=0` disables it, see [Model System](en/wiki/web/model-system))
   - `disableTopicDetection` / `disableBackgroundTasks`
   - **All five `skip*Permission` flags enabled**: sema-core has five independent switches for tool permission classes (MCP / FileEdit / ShellExec / Skill / FetchUrl); if any one is missed, the first time the LLM triggers a tool of that class the PermissionManager will `await` a response that never comes -- the session silently hangs. The web side has no permission UI yet, so all are skipped
   - `disabledTools: ['ask_form']` -- `askUserQuestion` goes through the `pick:option:request` flow, which is not governed by the skip flags; the only option is to disable the tool itself
3. Register and apply the LLM model (`resolveModel` -> `applyModel`, i.e. `core.addModel(cfg, true)` + `core.applyTaskModel({ main, quick })`)
4. `await core.createSession()` -- since sema-core 2.0.5 this returns `{ ok, session }`; **the session-level APIs (`processUserInput` / `interrupt` / `on` / `respondTo*`) all live on the returned `SemaSession`**, so event handlers must be attached only after it exists
5. `core.getRuleInfo(true)` / `getMemoryInfo(true)` -- force-reload AGENTS.md / MEMORY.md. `core.dispose()` only clears the caches of the RuleManager/MemoryManager singletons; the singletons themselves survive and rebuilding SemaCore does not trigger a reload; without the forced refresh, the Agent silently loses all domain rules after `resetSession()`
6. `wireEvents()` attaches events; `bus.emit` sends the `workspace:ready` / `plc:state` / `plc:variables` hydration messages, does the initial `.st` scan, starts file watching, and subscribes to `internal:*` commands on the bus

Two defensive listeners act as a fallback for any interaction request that slips through, preventing hangs (at the end of `wireEvents()`):

- `tool:permission:request` -> logs a warn then automatically calls `respondToToolPermission({ toolId, selected: 'agree' })`
- `pick:option:request` -> automatically cancels via `respondToPickOption({ requestId, selected: null })`

`resetSession()` (the UI "Reset Session") is a full restart: interrupt and wait for idle (up to 3s) -> stop the PLC -> broadcast `workspace:switching` (clears the frontend store and the gateway's sticky cache) -> `closeSession` + `core.dispose()` -> clear watchers/timers/internal state -> `cleanWorkspace()` empties the workspace -> `start()` again. `switchWorkspace()` is similar but does not delete files.

## Event Consumption: sema-core -> Frontend Messages

`wireEvents()` translates `SemaSession` events into the `ServerMessage` types of `shared/protocol.ts`:

| sema-core event | Handling |
|---|---|
| `message:thinking:chunk` / `message:text:chunk` | Forwarded to `BlockMapper`, driving the block protocol as a stream |
| `message:complete` | `BlockMapper.onMessageComplete`; when `hasToolCalls=false`, the turn is sealed |
| `tool:execution:start/chunk/complete/error` | `BlockMapper` opens/writes/closes tool blocks; `complete` also has bypass side effects (see below) |
| `todos:update` | Filtered by the watermark then emitted as `agent:todos` (see below) |
| `state:update` | Emits `agent:state` (`idle` / `processing`); the idle->processing edge freezes the todo watermark |
| `session:error` | Emits `error` with code/status/requestID attached (non-terminal, does not seal the turn) |
| `session:interrupted` | `BlockMapper.onInterrupted` -> the turn ends as `interrupted` |
| `conversation:usage` | Emits `agent:usage` after each AI response completes (useTokens/maxTokens, the context usage indicator above the input bar) |

### BlockMapper: Tool Calls -> UI Cards

`server/block-mapper.ts` is a **pure state machine** (no IO; the emit callback and clock are both injectable, covered by `tests/block-mapper.test.ts`): it assembles the streaming events above into the "block protocol" -- one assistant message per turn, internally interleaving `thinking` / `text` / `tool` blocks in their true order, mapping to `agent:turn-start` -> `agent:block-start/delta/end`* -> `agent:turn-end`. The frontend dispatches `tool` blocks to custom cards by `toolName` (Compile / Verify / Trace / Vars..., see [Frontend UI](en/wiki/web/frontend)). Key points:

- **Main Agent only**: tool/complete events with `agentId !== 'main'` are all dropped -- subagent (task-*) events leak from the same session bus, and without filtering they would seal the main turn prematurely (`MAIN_AGENT_ID` is a constant sema-core does not export, hardcoded here)
- **Three display truncation gates**: tool results 16KB, accumulated streaming chunks 16KB, block input 8KB (stCode / scene spec can reach tens of KB); results/streams over the limit get an `…[已截断]` marker appended, over-limit input degrades to `_truncated` + the first 8KB as a preview -- this affects display only, the tool results the Agent receives are untouched
- **Forced block-close fallback**: the first chunk of a new msgId, `message:complete`, idle, and interrupt all force-close open tool blocks that never received a complete event (todo-type tools emit no complete on success)
- **Mirror and snapshot**: the mapper maintains a block mirror of the current turn; when a new client connects, the gateway emits `internal:client-connected` and the bridge responds by broadcasting `agent:turn-snapshot` (the sticky cache stores state only, not chat blocks), so a tab joining mid-stream can still see the in-progress turn
- The mapper is rebuilt on every `start()`, resetting in sync with the session

### The Plan Card Watermark

sema-core's todo list **accumulates across turns**, and each `todos:update` carries the full list. On every idle->processing edge (a genuine new turn), the bridge freezes the watermark at the highest todo id seen so far and only forwards entries with `id > watermark` -- so the plan card only shows the current turn's plan. The watermark lives in a backend singleton, which is naturally consistent across multiple tabs / reconnects (see the `todoWatermark` field comment).

### Bypass Side Effects of Tool Completion

Besides feeding the mapper, `tool:execution:complete` also triggers actions by tool name (MCP tools look like `mcp__plc-tools__plc_status`, matched by suffix):

| Tool name suffix | Action |
|---|---|
| `plc_buildAndRun` / `plc_compile` | `mirrorCompiledStToFile()` + `refreshVariableMap()` (re-emits `plc:variables`, otherwise the Vars panel would stay on the previous program's symbols) |
| `plc_buildSimulation` | `emitSceneIfPresent()` pushes the new scene |
| `write_file` / `patch_file` / `edit` and other file-editing tools (excluding `plc_*`) | `scheduleRescan()` -- does not wait for fs.watch; the code panel updates as soon as the tool completes |

## Workspace Seeding (workspace-setup)

`setupWorkspaceIfNeeded()` in `server/workspace-setup.ts`:

1. Creates `$WORKSPACE` and `$WORKSPACE/.plc-vis/` (which holds `state.json`)
2. Recursively copies `sema-plc-web/templates/` -> workspace (AGENTS.md, `.sema/` (skills + `.mcp.json`), `config/`), **skipping files that already exist** (idempotent; after a template update, old workspaces do not receive new files -- use `cleanWorkspace()` or switch to a fresh WORKSPACE)
3. Performs placeholder substitution while copying: `__WORKSPACE__` -> the workspace's absolute path, `__PLC_TOOLS_CLI__` -> the absolute path of `sema-plc-tools/dist/cli.js` (overridable via `PLC_TOOLS_DIST`; on resolution failure the placeholder is kept and an error is reported, never silently injecting an empty string)
4. `reconcileMcpCliPath()` -- on every startup, repairs `args[0]` of plc-tools in `.sema/.mcp.json` to the current cli.js path, self-healing dead paths left behind after the repo directory is renamed (otherwise the MCP spawn fails with `MODULE_NOT_FOUND`)
5. `reconcileMcpModbusPort()` -- syncs the startup environment's `PLC_MODBUS_PORT` into the env block of `.mcp.json` (when sema-core launches plc-tools it passes **only** that env block, not the parent process environment)

For the workspace structure see [Workspace and Skills](en/wiki/web/workspace).

## Connecting to the plc-tools MCP (--lite)

The Agent's PLC tools are not wired directly by the bridge -- sema-core reads the workspace's `.sema/.mcp.json` and spawns plc-tools over stdio:

```json
{
  "mcpServers": {
    "plc-tools": {
      "transport": "stdio",
      "command": "node",
      "args": ["__PLC_TOOLS_CLI__", "serve", "--lite"],
      "env": { "PLC_STATE_FILE": "__WORKSPACE__/.plc-vis/state.json", "…": "…" }
    }
  }
}
```

`--lite` registers only read-only/low-risk tools (`sema-plc-tools/src/server.ts:282`): `plc_status`, `plc_readVariables`, `plc_getLogs`, `plc_detectIO`, `plc_buildSimulation`, `plc_stop`. Verification tools are physically removed from MCP; verification can only go through the verify runner (the CLI writes `state.json` directly). For the full tool list see [MCP Tools Reference](en/wiki/tools/mcp-tools).

There is no direct communication between the bridge and the MCP child process -- they connect through **shared files**: plc-tools writes `$WORKSPACE/.plc-vis/state.json` (compile artifact + variableMap) and `$WORKSPACE/config/scene.json`; the bridge reads them via `state-reader.ts` / file watching and broadcasts.

## Live .st File Sync

The code panel's liveness relies on three stacked mechanisms (`startFileWatcher()`):

1. **`fs.watch(workspace, { recursive: true })`** -- the primary channel; filters out `.sema/`, `.plc-vis/`, `node_modules`; non-project files (anything other than `.st/.yaml/.yml/.json/.toml`) are ignored
2. **1s polling fallback** -- `fs.watch({recursive})` **silently fails to fire** on some platforms (observed broken on Node 26 / macOS), and the editor only updates on `editor:open`; without the fallback the code panel would freeze. `rescanAndEmit` diffs using a file signature (concatenated `path:mtime`), so it is a cheap no-op when nothing changed
3. **Direct trigger on tool completion** -- when an Agent file-editing tool completes, `scheduleRescan()` is called directly (150ms debounce)

Each round of `rescanAndEmit()`: emits `editor:files` only when the file list changed; re-emits the scene when the mtime of `config/scene.json` changed; refreshes the variableMap when the mtime of `.plc-vis/state.json` changed (the CodeAct verify runner writes state.json directly via the CLI without going through MCP tool events -- this is its fallback channel); if the currently open file still exists, its latest content is re-emitted every round (`editor:open`, no mtime check, so Agent rewrites are naturally picked up); if it was deleted, falls back to the newest `.st` (**not** `files[0]` -- the list is sorted by mtime descending and includes config JSON, so a freshly written scene file would rank first, and opening it would make the Run button try to compile JSON).

### The `_running.st` Mirror

The LLM can call `plc_buildAndRun` with inline `stCode` (Path B) -- in that case `state.json` has the source but the workspace has no corresponding `.st` file, leaving the editor and ladder diagram with nothing to display. `mirrorCompiledStToFile()` mirrors `state.json.lastCompile.stCode` into `src/programs/_running.st` (skipped if a `.st` with identical content already exists). The reverse self-cleanup happens at the start of `rescanAndEmit()`: once another `.st` holds the same source (the Agent has written a properly named file), `_running.st` is deleted, so no duplicate copy of the running program lingers in the workspace.

## Reusing Scene Spec Validation

`emitSceneIfPresent()` validates the scene **at read time**: it directly imports `validateSceneSpec(scene, variableNames)` from `sema-plc-tools/dist/tools/sceneSpec.js` -- the same implementation used by the build gate of `plc_buildSimulation`. So even a `config/scene.json` written by the Agent via a direct `write_file`, bypassing the tool, cannot escape validation; errors/warnings are sent along with `scene:ready` and the UI shows them above the simulation, instead of silently rendering a dead diagram. An mtime guard makes repeated calls a no-op while the file is unchanged; startup hydration uses `force: true` to force a re-emit for late-joining clients.
