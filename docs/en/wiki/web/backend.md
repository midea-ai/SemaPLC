# Backend Overview

The `sema-plc-web` backend is a single Node process: express HTTP (`:3001`) plus ws WebSocket (`:3002`), both bound to `127.0.0.1` only -- this is a local development tool, and plaintext HTTP is intentional. For the overall architecture see [Architecture](en/wiki/overview/architecture).

## Process Assembly Order

The entry point is `server/index.ts`; the order reflects the dependencies:

1. `installRelayHeaderFix()` -- **runs first**: strips the OpenAI SDK's UA / `x-stainless-*` fingerprint headers, otherwise some third-party relays return 403
2. `loadConfig()` -- reads `--workspace` / `$WORKSPACE` (default `~/plc-workspace`), `$PORT`, `$WS_PORT`, `$PLC_TOOLS_DIST`, etc.
3. `applyKeyOverrides()` -- merges API keys filled in via the UI into `process.env` (`.env` takes precedence); must run before the model registry is built
4. `createHttpServer()` -> `new PlcMonitor()` -> `new PlcController()` -> `new WsGateway()` (the connection-count callback wires monitor start/stop)
5. `semaBridge.start()` -- async: seeds the workspace, creates the SemaCore session, hydrates state, starts file watching
6. `httpServer.listen()`; on `SIGINT`, shutdown proceeds in reverse order: gateway -> monitor -> bridge -> http

Modules do not call each other directly (except monitor/controller) -- all messages flow through the in-process bus in `event-bus.ts`.

## Module Overview

| Module | File | Responsibility | Deep-dive page |
|---|---|---|---|
| SemaBridge | `server/sema-bridge.ts` | Embedded sema-core Agent: session lifecycle, event-to-frontend-message translation, live `.st` sync, workspace seeding | [SemaBridge: Embedded Agent Integration](en/wiki/web/sema-bridge) |
| BlockMapper | `server/block-mapper.ts` | Pure state machine turning sema-core streaming events into the block protocol (thinking/text/tool cards) | Same as above |
| workspace-setup | `server/workspace-setup.ts` | Template copying, `.mcp.json` placeholder substitution and self-healing, file scanning | Same as above |
| Model registry | `server/model-registry.ts` | Built-in model table, `VERIFIED_MODEL_KEYS`, `PLC_MODEL`/`PLC_THINKING` | [Model System](en/wiki/web/model-system) |
| Custom models / keys | `server/custom-models.ts`, `key-overrides.ts` | `custom-models.json` / `key-overrides.json` persistence | Same as above |
| relay-fetch-fix | `server/relay-fetch-fix.ts` | Global fetch interception, strips SDK fingerprint headers | Same as above |
| Event bus | `server/event-bus.ts` | In-process singleton bus for `ServerMessage` + `internal:*` | [Realtime Channel](en/wiki/web/realtime) |
| PlcMonitor | `server/plc-monitor.ts` | Polls status/variables every 500ms, pushes after diff; starts/stops based on client count | Same as above |
| PlcController | `server/plc-controller.ts` | Manual Run/Stop/Force/Logs, imports plc-tools dist directly; `setMuted` mutes during operations | Same as above |
| WsGateway | `server/ws-gateway.ts` | JSON-over-WS broadcast; STICKY_TYPES cached replay | Same as above |
| WS protocol | `shared/protocol.ts` | Message type definitions shared between frontend and backend | Same as above |
| state-reader | `server/state-reader.ts` | Reads `$WORKSPACE/.plc-vis/state.json` (plc-tools compile artifact) | -- |

## HTTP Routes (`server/routes/`)

| Route | Function |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/config` | workspace/ports/version + current model configuration |
| `POST /api/normalize` | ST normalization (docker exec `iec2iec`, container name validated against a whitelist) |
| `POST /api/check` | ST syntax check (reuses plc-tools `handleCheck`) |

In dev mode the frontend is served by Vite (`:5173`), see [Frontend UI](en/wiki/web/frontend); `http-server.ts` also registers `express.static` static hosting, but its path resolves to `web/dist`, which does not match Vite's actual output directory `dist/`.

## Two Paths to plc-tools

The same `sema-plc-tools/dist` implementation is reached via two paths: the Agent goes through the MCP child process spawned by sema-core (`serve --lite`, read-only/low-risk tools only); manual operations are invoked by PlcController via **direct import**. The two connect through shared files (`.plc-vis/state.json`, `config/scene.json`) and SemaBridge's file watching. For the tools themselves see [MCP Tools Reference](en/wiki/tools/mcp-tools).
