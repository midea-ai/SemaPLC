# 后端总览

`sema-plc-web` 后端是单个 Node 进程:express HTTP(`:3001`)+ ws WebSocket(`:3002`),均只绑定 `127.0.0.1`——这是一个本机开发工具,明文 HTTP 是有意的。整体架构见 [架构设计](wiki/overview/architecture)。

## 进程装配顺序

入口 `server/index.ts`,顺序即依赖:

1. `installRelayHeaderFix()` —— **最先执行**:抹掉 OpenAI SDK 的 UA / `x-stainless-*` 指纹头,否则部分第三方中转会 403
2. `loadConfig()` —— 读 `--workspace` / `$WORKSPACE`(默认 `~/plc-workspace`)、`$PORT`、`$WS_PORT`、`$PLC_TOOLS_DIST` 等
3. `applyKeyOverrides()` —— 把 UI 补填的 API key merge 进 `process.env`(`.env` 优先),必须早于模型注册表构建
4. `createHttpServer()` → `new PlcMonitor()` → `new PlcController()` → `new WsGateway()`(连接数回调接 monitor 起停)
5. `semaBridge.start()` —— 异步:种子化工作区、创建 SemaCore 会话、水合状态、启动文件监视
6. `httpServer.listen()`;`SIGINT` 时按 网关 → monitor → bridge → http 逆序关停

模块之间不互相直接调用(monitor/controller 除外)——统一经 `event-bus.ts` 的进程内总线收发消息。

## 模块一览

| 模块 | 文件 | 职责 | 深度页 |
|---|---|---|---|
| SemaBridge | `server/sema-bridge.ts` | 内嵌 sema-core Agent:会话生命周期、事件→前端消息翻译、`.st` 实时同步、工作区种子化 | [SemaBridge:内嵌 Agent 集成](wiki/web/sema-bridge) |
| BlockMapper | `server/block-mapper.ts` | sema-core 流式事件 → 块协议(thinking/text/tool 卡片)的纯状态机 | 同上 |
| workspace-setup | `server/workspace-setup.ts` | 模板拷贝、`.mcp.json` 占位替换与自愈、文件扫描 | 同上 |
| 模型注册表 | `server/model-registry.ts` | 内置模型表、`VERIFIED_MODEL_KEYS`、`PLC_MODEL`/`PLC_THINKING` | [模型系统](wiki/web/model-system) |
| 自定义模型 / key | `server/custom-models.ts`、`key-overrides.ts` | `custom-models.json` / `key-overrides.json` 持久化 | 同上 |
| relay-fetch-fix | `server/relay-fetch-fix.ts` | 全局 fetch 拦截,抹 SDK 指纹头 | 同上 |
| 事件总线 | `server/event-bus.ts` | `ServerMessage` + `internal:*` 的进程内单例总线 | [实时通道](wiki/web/realtime) |
| PlcMonitor | `server/plc-monitor.ts` | 500ms 轮询状态/变量,diff 后推送;按客户端数起停 | 同上 |
| PlcController | `server/plc-controller.ts` | 手动 Run/Stop/Force/Logs,直接 import plc-tools dist;操作期 `setMuted` 静音 | 同上 |
| WsGateway | `server/ws-gateway.ts` | JSON-over-WS 广播;STICKY_TYPES 缓存重放 | 同上 |
| WS 协议 | `shared/protocol.ts` | 前后端共享的消息类型定义 | 同上 |
| state-reader | `server/state-reader.ts` | 读 `$WORKSPACE/.plc-vis/state.json`(plc-tools 编译产物) | — |

## HTTP 路由(`server/routes/`)

| 路由 | 功能 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/config` | workspace/端口/版本 + 当前模型配置 |
| `POST /api/normalize` | ST 规范化(docker exec `iec2iec`,容器名经白名单校验) |
| `POST /api/check` | ST 语法检查(复用 plc-tools `handleCheck`) |

开发模式前端由 Vite(`:5173`)提供,见 [前端界面](wiki/web/frontend);`http-server.ts` 里还注册了 `express.static` 静态托管,但其路径解析为 `web/dist`,与 Vite 实际输出目录 `dist/` 并不一致。

## 与 plc-tools 的两条通路

同一套 `sema-plc-tools/dist` 实现被走两条路:Agent 经 sema-core spawn 的 MCP 子进程(`serve --lite`,只读/低危工具);手动操作由 PlcController **直接 import** 调用。两者经共享文件(`.plc-vis/state.json`、`config/scene.json`)与 SemaBridge 的文件监视衔接。工具本身见 [MCP 工具参考](wiki/tools/mcp-tools)。
