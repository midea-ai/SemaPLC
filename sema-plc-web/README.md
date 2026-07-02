# sema-plc-web

Localhost, Agent-driven IDE for OpenPLC. Type a control task in plain language into the chat panel; the embedded [sema-core](https://github.com/midea-ai/sema-code-core) Agent writes IEC 61131-3 Structured Text, compiles it, deploys it to a running OpenPLC, and the UI shows the **ladder diagram + live variable values + process simulation + tool-call log**.

> This app is the IDE; [`sema-plc-tools`](../sema-plc-tools/) is the toolchain it drives (MCP tools + the OpenPLC Docker runtime). The two live side by side in the same repo.

## What you can do

- Describe a requirement ("latch a motor on the start button, stop on E-stop") and get a running ST program — generated, compiled, deployed, and behavior-verified automatically.
- Watch the generated logic as a live ladder diagram and a process simulation animated by real PLC values.
- Manually Start / Stop the PLC, edit the ST source in the built-in editor, and inspect variables / tool calls / runtime logs.

## Prerequisites

- **Node.js ≥ 18** and **npm**
- **Docker** running (for the OpenPLC runtime container)
- **An LLM API key** — DeepSeek recommended; MiniMax, Anthropic, Gemini, OpenAI, xAI, Groq, OpenRouter, Qwen, Kimi, Z.AI, SiliconFlow, Together, and OpenAI-compatible endpoints are supported

## Quick start (one command)

`./dev.sh` does everything: starts the OpenPLC container → builds `sema-plc-tools` → (re)starts the dev server (foreground):

```bash
# first time only: install deps for this app and for the toolchain it imports
npm install
( cd ../sema-plc-tools && npm install && npm run build )

# configure your key
cp .env.example .env          # then edit .env: DEEPSEEK_API_KEY=sk-...

# run
./dev.sh                      # default: deepseek
PLC_MODEL=minimax-m2.7 ./dev.sh
```

Open **<http://localhost:5173>** and describe a control requirement in the chat panel.

Tunable env vars (all have defaults): `PLC_MODEL` (model), `PLC_THINKING` (0/1; for DeepSeek `0` is recommended to avoid the 8192-token output cap), `WORKSPACE` (the Agent's working dir, default `/tmp/plc-ver-ws`), `ENV_FILE` (where keys are sourced, default this folder's `.env`).

Without a key the app still starts — the UI, PLC Run/Stop and all tabs work; only the chat (Agent) is disabled until you set a key and restart.

## Manual start

Instead of `./dev.sh` you can drive the pieces yourself:

```bash
# 1. OpenPLC runtime
( cd ../sema-plc-tools/runtime && docker-compose up -d )

# 2. build the toolchain (the backend direct-imports its dist/)
( cd ../sema-plc-tools && npm install && npm run build )

# 3. start backend + frontend (one process, via concurrently)
DEEPSEEK_API_KEY=sk-... WORKSPACE=/tmp/plc-workspace npm run dev
```

You should see four lines once it's up:

```
[SERVER] HTTP ready on http://127.0.0.1:3001
[SERVER] WS ready on ws://127.0.0.1:3002
[SERVER] [plc-tools] MCP server ready
[VITE]   ➜  Local:   http://localhost:5173/
```

**Stop:** `Ctrl-C`, or `pkill -f "concurrently" ; pkill -f "tsx.*server" ; pkill -f vite`.
**Fresh workspace:** `rm -rf "$WORKSPACE"` and restart — templates are re-seeded automatically.

## Choosing the model

`PLC_MODEL` picks the LLM; provide the matching `*_API_KEY`. If `PLC_MODEL` is unset, it falls back by key priority: `DEEPSEEK`, `MINIMAX`, `ANTHROPIC`, `GEMINI`, then the newer OpenAI-compatible providers listed below.

| `PLC_MODEL` | Model | Key |
|---|---|---|
| `deepseek` | deepseek-v4-flash | `DEEPSEEK_API_KEY` |
| `deepseek-v4-pro` | deepseek-v4-pro | `DEEPSEEK_API_KEY` |
| `minimax` / `minimax-m3` | MiniMax-M3 | `MINIMAX_API_KEY` |
| `minimax-m2.7` / `minimax-m2.5` | MiniMax-M2.7 / M2.5 | `MINIMAX_API_KEY` |
| `anthropic` | claude-opus-4-7 | `ANTHROPIC_API_KEY` |
| `gemini` / `gemini-2.5-flash` / `gemini-2.5-pro` | Gemini 2.5 | `GEMINI_API_KEY` |
| `openai` | gpt-5.4 | `OPENAI_API_KEY` |
| `gpt-5.5` | gpt-5.5 | `OPENAI_API_KEY` |
| `xai` | grok-4.3 | `XAI_API_KEY` |
| `groq` | openai/gpt-oss-120b | `GROQ_API_KEY` |
| `openrouter` | ~openai/gpt-latest | `OPENROUTER_API_KEY` |
| `qwen` / `dashscope` | qwen-plus | `QWEN_API_KEY` |
| `kimi` / `moonshot` | kimi-k2.6 | `KIMI_API_KEY` |
| `zai` / `zhipu` | glm-4.7 | `ZAI_API_KEY` |
| `siliconflow` | Pro/zai-org/GLM-4.7 | `SILICONFLOW_API_KEY` |
| `together` | MiniMaxAI/MiniMax-M3 | `TOGETHER_API_KEY` |
| `ollama` | qwen2.5-coder:32b | optional `OLLAMA_API_KEY` |
| `openai-compatible` / `custom` | your model | `PLC_OPENAI_COMPATIBLE_API_KEY` |

Every preset supports overrides: `<PREFIX>_MODEL`, `<PREFIX>_BASE_URL`, `<PREFIX>_MAX_TOKENS`, and `<PREFIX>_CONTEXT_LENGTH` (for example `OPENAI_MODEL`, `QWEN_BASE_URL`, or `GROQ_MAX_TOKENS`). The generic OpenAI-compatible entry uses `PLC_OPENAI_COMPATIBLE_MODEL`, `PLC_OPENAI_COMPATIBLE_BASE_URL`, `PLC_OPENAI_COMPATIBLE_API_KEY`, `PLC_OPENAI_COMPATIBLE_MAX_TOKENS`, and `PLC_OPENAI_COMPATIBLE_CONTEXT_LENGTH`.

All MiniMax variants share one `MINIMAX_API_KEY`; switch models by changing `PLC_MODEL` only. Gemini uses the OpenAI-compatible endpoint; the 2.5 series runs the full tool loop (Gemini 3.x entries are still experimental because they require `thought_signature` round-tripping in the embedded adapter).

Example custom endpoint:

```bash
PLC_MODEL=openai-compatible
PLC_OPENAI_COMPATIBLE_API_KEY=sk-...
PLC_OPENAI_COMPATIBLE_MODEL=my-agentic-model
PLC_OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1
PLC_OPENAI_COMPATIBLE_PROVIDER=openai
```

## Usage

Open <http://localhost:5173> and type a requirement in the chat. The Agent writes ST → compiles → deploys → behavior-verifies (force inputs / trace variables) → builds the live process simulation. Things to try:

- `写一个 1Hz 心跳:让 %QX0.0 每 500ms 翻转一次,用 TON 定时器实现。`
- `按钮 %IX0.0 按下后电机 %QX0.0 锁存启动,急停 %IX0.1 按下立即停止。`
- `三相交通灯状态机:绿 5s → 黄 2s → 红 5s 循环。`

You can also paste or edit ST directly in the left editor and click **Start** to run it without the Agent.

## UI overview

- **Top bar** — workspace path (✏ to edit, Enter to switch), PLC status badge, Start / Stop buttons, WS connection indicator.
- **Left column** — ST source editor (CodeMirror, with ST syntax highlighting; edit + Save to write back to the workspace file).
- **Center column** — ladder diagram via React Flow (contact / coil / timer / counter / comparator / power rail). Falls back to a source-preview box when a construct isn't representable as ladder.
- **Right column** — tabs: **Chat** (Agent conversation), **Vars** (live values, 500 ms polling), **过程仿真** (native simulation animated by PLC values).
- **Bottom panel** — logs (tool calls / runtime / state changes / errors, color-coded).

All column edges and the bottom panel are draggable to resize.

The **过程仿真** tab uses the native SimRuntime (a Scene Spec + parts library, animated live from PLC values). The Agent generates it via `plc_buildSimulation` (writes `config/scene.json`); no extra container or service is needed.

## Architecture

Single Node process:

```
Browser (Vite + React 18, :5173)
  │  /api/* (proxied to :3001)
  │  WebSocket → ws://localhost:3002
  ▼
sema-plc-web backend (:3001 HTTP + :3002 WS)
  ├── HTTP   ──→ /api/health, /api/config, /api/normalize (docker exec iec2iec)
  └── WS bus ──→ sema-bridge       (embeds SemaCore, runs the Agent)
                 plc-controller    (user-triggered Run/Stop, direct-imports plc-tools)
                 plc-monitor       (500 ms polling, direct-imports plc-tools)

  Direct import (no spawn) ↓
  ../sema-plc-tools/dist
```

The backend embeds `sema-core` and exposes its events as `agent:*` / `plc:*` / `log` over JSON-over-WebSocket (see `shared/protocol.ts`). The frontend connects with auto-reconnect; Zustand stores self-subscribe to the event types they care about.

> **sema-core is vendored** as a tarball in [`vendor/`](vendor/) and installed via a `file:` dependency in `package.json`. It is a build of [midea-ai/sema-code-core](https://github.com/midea-ai/sema-code-core) that emits the `tool:execution:start` event (carrying each tool's name + original input) the IDE needs to render tool blocks and the tool-call log. Published npm releases don't emit that event yet, so the app would otherwise show tool calls without their inputs. Re-vendor with `npm pack` in the sema-core repo and replace the tarball when upstream publishes a release with the event.

A workspace is a single local directory (= `SemaCore.workingDir`), set via `--workspace <path>` or `WORKSPACE` (default `~/plc-workspace`). On first use, `.sema/.mcp.json` + `AGENTS.md` + the skills are seeded into it from `templates/`.

## Configuration

| Var / arg | Default | Purpose |
|---|---|---|
| `--workspace <path>` / `$WORKSPACE` | `~/plc-workspace` | sema-core workingDir; templates seeded here |
| `$PORT` | `3001` | HTTP port |
| `$WS_PORT` | `3002` | WS port |
| `$PLC_URL` | `https://localhost:8443` | OpenPLC Runtime REST API |
| `$PLC_CONTAINER` | `openplc-plc-dev` | Docker container name |
| `$PLC_MODEL` / `$*_API_KEY` | — | LLM selection + key (see *Choosing the model*) |
| `$PLC_THINKING` | `1` | Stream model "thinking" blocks; `0` to disable |
| `$PLC_MODBUS_PORT` | — (off) | Optional. Set (e.g. `502`) to bundle a `modbus_slave` config into each program so OpenPLC exposes its located IO over Modbus TCP for external SCADA. Also expose the port in `../sema-plc-tools/runtime/docker-compose.yml` if the client runs outside the container. |

## Tests

```bash
npm test                                  # sema-plc-web: 224 tests (server: vitest/node, frontend: vitest/jsdom)
( cd ../sema-plc-tools && npm test )      # @sema/plc-tools: 542 tests
```

## Troubleshooting

- **`EADDRINUSE` on `:3001` / `:3002`, or Vite says `:5173` is in use** — a previous run is still alive. `pkill -f "concurrently" ; pkill -f "tsx.*server" ; pkill -f vite`, then check `lsof -i :3001 -i :3002 -i :5173 -sTCP:LISTEN` (no output = clear).
- **`Cannot find package 'socket.io-client'` at startup** — the backend direct-imports `../sema-plc-tools/dist`; run `npm install && npm run build` in `../sema-plc-tools/`.
- **WS shows `closed` repeatedly** — the backend isn't running (the frontend retries with backoff). Check the terminal where `npm run dev` / `./dev.sh` runs.
- **PLC stuck at `EMPTY`** — nothing has compiled yet. Try a simpler request first (e.g. a 1 Hz heartbeat), or paste valid ST and click **Start**.
- **Chat disabled / "LLM key … 未设置"** — no API key. Copy `.env.example` → `.env`, set one `*_API_KEY`, and restart.
- **Ladder shows a fallback box** — the transformer can't render that ST construct, so the source is shown instead. Normal for complex programs.
- **Variables don't update** — confirm the PLC is `RUNNING`; `docker logs openplc-plc-dev` for runtime issues. `plc-monitor` polls only while a WS client is connected.

## Attribution

- `src/lang/`, `src/models/`, `src/transformer/`, and `src/ladder-nodes/` are lifted from [cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor) (MIT). See `LICENSE`.
- WebSocket-gateway and embedded-Agent patterns adapted from [midea-ai/SemaClaw](https://github.com/midea-ai/SemaClaw).
- Embedded LLM Agent via [midea-ai/sema-code-core](https://github.com/midea-ai/sema-code-core).
