# SemaBridge:内嵌 Agent 集成

`server/sema-bridge.ts` 是后端最大的单文件(约 790 行):它把 `sema-core` Agent 框架**内嵌**在 Web 后端进程里,负责会话生命周期、sema-core 事件到前端消息的翻译、工作区种子化与 `.st` 文件实时同步。它不直接持有 WebSocket——一切输入输出都经 [事件总线](wiki/web/realtime) 收发。

> `sema-core` 以 tarball 形式 vendored 在 `sema-plc-web/vendor/sema-core-2.0.5.tgz`,`package.json` 里经 `"sema-core": "file:vendor/sema-core-2.0.5.tgz"` 安装——需要 `tool:execution:start` 等事件,npm 发布版尚未包含。

## SemaCore / SemaSession 生命周期

`start()` 的顺序(`sema-bridge.ts:62`):

1. `setupWorkspaceIfNeeded(workspace)` —— 工作区种子化(见下)
2. `new SemaCore({...})` —— 关键构造参数:
   - `workingDir: workspace`、`stream: true`、`thinking: getRuntimeThinking()`(`PLC_THINKING=0` 关闭,详见 [模型系统](wiki/web/model-system))
   - `disableTopicDetection` / `disableBackgroundTasks`
   - **五个 `skip*Permission` 标志全开**:sema-core 对工具权限有五类独立开关(MCP / FileEdit / ShellExec / Skill / FetchUrl),漏掉任何一个,LLM 首次触发该类工具时 PermissionManager 会 `await` 一个永远不来的响应——会话静默挂死。Web 端暂无权限 UI,故全部跳过
   - `disabledTools: ['ask_form']` —— `askUserQuestion` 走 `pick:option:request` 流程,不受 skip 标志控制,只能禁用工具本身
3. 注册并应用 LLM 模型(`resolveModel` → `applyModel`,即 `core.addModel(cfg, true)` + `core.applyTaskModel({ main, quick })`)
4. `await core.createSession()` —— sema-core 2.0.5 起返回 `{ ok, session }`,**会话级 API(`processUserInput` / `interrupt` / `on` / `respondTo*`)都在返回的 `SemaSession` 上**,事件必须在它存在之后再挂
5. `core.getRuleInfo(true)` / `getMemoryInfo(true)` —— 强制重载 AGENTS.md / MEMORY.md。`core.dispose()` 只清空 RuleManager/MemoryManager 单例的缓存,单例本身存活且重建 SemaCore 不会触发重载;不强刷的话 `resetSession()` 后 Agent 会静默丢失全部领域规则
6. `wireEvents()` 挂事件、`bus.emit` 下发 `workspace:ready` / `plc:state` / `plc:variables` 水合消息、初次 `.st` 扫描、启动文件监视、订阅总线 `internal:*` 命令

两个防御性监听兜底任何漏网的交互请求,避免挂死(`wireEvents()` 末尾):

- `tool:permission:request` → 记 warn 日志后自动 `respondToToolPermission({ toolId, selected: 'agree' })`
- `pick:option:request` → 自动 `respondToPickOption({ requestId, selected: null })` 取消

`resetSession()`(UI「重置会话」)是一次完整重启:interrupt 并等 idle(最多 3s)→ 停 PLC → 广播 `workspace:switching`(清前端 store 与网关 sticky 缓存)→ `closeSession` + `core.dispose()` → 清 watcher/timer/内部状态 → `cleanWorkspace()` 清空工作区 → 重新 `start()`。`switchWorkspace()` 类似但不清文件。

## 事件消费:sema-core → 前端消息

`wireEvents()` 把 `SemaSession` 事件翻译成 `shared/protocol.ts` 的 `ServerMessage`:

| sema-core 事件 | 处理 |
|---|---|
| `message:thinking:chunk` / `message:text:chunk` | 转发给 `BlockMapper`,流式驱动块协议 |
| `message:complete` | `BlockMapper.onMessageComplete`;`hasToolCalls=false` 时封口 turn |
| `tool:execution:start/chunk/complete/error` | `BlockMapper` 开/写/关工具块;`complete` 另有旁路副作用(见下) |
| `todos:update` | 水位线过滤后发 `agent:todos`(见下) |
| `state:update` | 发 `agent:state`(`idle` / `processing`);idle→processing 沿冻结 todo 水位线 |
| `session:error` | 拼上 code/status/requestID 后发 `error`(非终态,不封 turn) |
| `session:interrupted` | `BlockMapper.onInterrupted` → turn 以 `interrupted` 收尾 |
| `conversation:usage` | 每次 AI 响应完成后发 `agent:usage`(useTokens/maxTokens,输入栏上下文用量指示) |

### BlockMapper:工具调用 → UI 卡片

`server/block-mapper.ts` 是一个**纯状态机**(无 IO,emit 回调与时钟均可注入,`tests/block-mapper.test.ts` 覆盖):把上表的流式事件组装成「块协议」——一个 turn 一条 assistant 消息,内部按真实顺序交错 `thinking` / `text` / `tool` 三类块,对应 `agent:turn-start` → `agent:block-start/delta/end`* → `agent:turn-end`。前端按 `toolName` 把 `tool` 块分发到定制卡片(Compile / Verify / Trace / Vars…,见 [前端界面](wiki/web/frontend))。要点:

- **只认主 Agent**:`agentId !== 'main'` 的工具/complete 事件全部丢弃——子代理(task-*)事件会从同一 session 总线泄漏,不过滤会把主 turn 提前封口(`MAIN_AGENT_ID` 是 sema-core 未导出的常量,此处硬编码)
- **三道显示截断门**:工具结果 16KB、流式 chunk 累计 16KB、块输入 8KB(stCode / scene spec 可达几十 KB),结果/流式超限附 `…[已截断]` 标注、输入超限降级为 `_truncated` + 前 8KB preview——只影响显示,Agent 拿到的工具结果不受影响
- **强制关块兜底**:新 msgId 的首个 chunk、`message:complete`、idle、interrupt 都会把没收到 complete 事件的开放工具块强制关闭(todo 类工具成功时不发 complete)
- **镜像与快照**:mapper 维护当前 turn 的块镜像;新客户端连接时网关发 `internal:client-connected`,bridge 应答广播 `agent:turn-snapshot`(sticky 缓存只存状态,不存聊天块),中途加入的 tab 也能看到进行中的流式 turn
- mapper 在每次 `start()` 重建,与会话同步复位

### 计划卡片的水位线

sema-core 的 todo 列表**跨 turn 累积**,每个 `todos:update` 携带全量列表。bridge 在每次 idle→processing 沿(真正的新 turn)把水位线冻结为已见的最大 todo id,只转发 `id > watermark` 的条目——计划卡片因此只显示当前 turn 的计划。水位线存在后端单例里,天然对多 tab / 重连一致(`todoWatermark` 字段注释)。

### 工具完成的旁路副作用

`tool:execution:complete` 除了进 mapper,还按工具名(MCP 工具形如 `mcp__plc-tools__plc_status`,按后缀匹配)触发:

| 工具名后缀 | 动作 |
|---|---|
| `plc_buildAndRun` / `plc_compile` | `mirrorCompiledStToFile()` + `refreshVariableMap()`(重发 `plc:variables`,否则 Vars 面板停留在上一程序的符号) |
| `plc_buildSimulation` | `emitSceneIfPresent()` 推送新场景 |
| `write_file` / `patch_file` / `edit` 等文件编辑类(排除 `plc_*`) | `scheduleRescan()` —— 不等 fs.watch,工具一完成代码面板立即更新 |

## 工作区种子化(workspace-setup)

`server/workspace-setup.ts` 的 `setupWorkspaceIfNeeded()`:

1. 建 `$WORKSPACE` 与 `$WORKSPACE/.plc-vis/`(存放 `state.json`)
2. 递归拷贝 `sema-plc-web/templates/` → 工作区(AGENTS.md、`.sema/`(skills + `.mcp.json`)、`config/`),**已存在的文件跳过**(幂等;模板更新后旧工作区拿不到新文件,需 `cleanWorkspace()` 或换新 WORKSPACE)
3. 拷贝时做占位替换:`__WORKSPACE__` → 工作区绝对路径,`__PLC_TOOLS_CLI__` → `sema-plc-tools/dist/cli.js` 绝对路径(可用 `PLC_TOOLS_DIST` 覆盖;解析失败保留占位符并报错,不静默注入空串)
4. `reconcileMcpCliPath()` —— 每次启动把 `.sema/.mcp.json` 里 plc-tools 的 `args[0]` 修复为当前 cli.js 路径,自愈仓库目录改名后遗留的死路径(否则 MCP spawn `MODULE_NOT_FOUND`)
5. `reconcileMcpModbusPort()` —— 把启动环境的 `PLC_MODBUS_PORT` 同步进 `.mcp.json` 的 env 块(sema-core 启动 plc-tools 时**只**传该 env 块,不继承父进程环境)

工作区结构详见 [工作区与 Skills](wiki/web/workspace)。

## 与 plc-tools MCP 的连接(--lite)

Agent 的 PLC 工具不是 bridge 直连的——sema-core 读工作区 `.sema/.mcp.json`,以 stdio 方式 spawn plc-tools:

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

`--lite` 只注册只读/低危工具(`sema-plc-tools/src/server.ts:282`):`plc_status`、`plc_readVariables`、`plc_getLogs`、`plc_detectIO`、`plc_buildSimulation`、`plc_stop`。验证类工具从 MCP 物理移除,验证只能经 verify runner(CLI 直写 `state.json`)。完整工具列表见 [MCP 工具参考](wiki/tools/mcp-tools)。

bridge 与 MCP 子进程之间没有直接通信——通过**共享文件**衔接:plc-tools 写 `$WORKSPACE/.plc-vis/state.json`(编译产物 + variableMap)与 `$WORKSPACE/config/scene.json`,bridge 经 `state-reader.ts` / 文件监视读取并广播。

## .st 文件实时同步

代码面板的实时性靠三层机制叠加(`startFileWatcher()`):

1. **`fs.watch(workspace, { recursive: true })`** —— 主通道,过滤 `.sema/`、`.plc-vis/`、`node_modules`,非项目文件(`.st/.yaml/.yml/.json/.toml` 之外)忽略
2. **1s 轮询兜底** —— `fs.watch({recursive})` 在部分平台**静默不触发**(实测 Node 26 / macOS 失效),而编辑器只在 `editor:open` 时更新,没有兜底代码面板会冻结。`rescanAndEmit` 用文件签名(`path:mtime` 拼接)diff,无变化时是廉价 no-op
3. **工具完成直触** —— Agent 文件编辑类工具 complete 时直接 `scheduleRescan()`(150ms debounce)

`rescanAndEmit()` 每轮:文件列表变化才发 `editor:files`;`config/scene.json` mtime 变了重发场景;`.plc-vis/state.json` mtime 变了刷新 variableMap(CodeAct verify runner 经 CLI 直写 state.json、不经 MCP 工具事件,这是它的兜底通道);当前打开文件仍存在则每轮重发其最新内容(`editor:open`,不做 mtime 判断,Agent 重写自然被覆盖),被删则回退到最新的 `.st`(**不是** `files[0]`——列表按 mtime 降序且含 config JSON,刚写的场景文件会排第一,打开它会让 Run 按钮去编译 JSON)。

### `_running.st` 镜像

LLM 可以带 inline `stCode` 调 `plc_buildAndRun`(Path B)——此时 `state.json` 有源码但工作区没有对应 `.st` 文件,编辑器和梯形图无内容可显示。`mirrorCompiledStToFile()` 把 `state.json.lastCompile.stCode` 镜像写到 `src/programs/_running.st`(已有同内容 `.st` 时跳过)。反向的自清理在 `rescanAndEmit()` 开头:一旦别的 `.st` 持有相同源码(Agent 落了真实命名文件),删除 `_running.st`,工作区不会残留运行程序的副本。

## Scene Spec 校验的复用

`emitSceneIfPresent()` 在**读取时**校验场景:直接 import `sema-plc-tools/dist/tools/sceneSpec.js` 的 `validateSceneSpec(scene, variableNames)`——与 `plc_buildSimulation` 构建门用的是同一实现。这样绕过工具、由 Agent 直接 `write_file` 写出的 `config/scene.json` 也逃不过校验,错误/警告随 `scene:ready` 一起下发,UI 显示在仿真上方,而不是静默渲染成一个死图。mtime 守卫保证文件未变时重复调用是 no-op;启动水合用 `force: true` 强制重发给晚加入的客户端。
