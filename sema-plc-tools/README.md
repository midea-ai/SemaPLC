# sema-plc-tools — `@sema/plc-tools`

The PLC toolchain that powers [`sema-plc-web`](../sema-plc-web/). It exposes **16 tools** covering the full OpenPLC loop — syntax self-check → matiec compile → upload → run → read / force / trace variables → behavior-verify → build a process simulation — and you can use them **two ways**:

- **CLI** — `node dist/cli.js <command>`, to drive OpenPLC straight from the terminal (no agent needed).
- **MCP server** — `node dist/cli.js serve`, so any MCP-capable agent (including the bundled IDE) can call the same tools.

It also ships the **OpenPLC v4 Docker runtime** the whole project runs against.

This directory **is the npm package** (`package.json` / `src` / `tests` at the root) plus its runtime:

```
sema-plc-tools/             ← @sema/plc-tools package root
├── src/  tests/             # package source + tests
├── dist/                    # build output (git-ignored — you build it)
└── runtime/                 # OpenPLC v4 Docker runtime
    ├── docker-compose.yml  Dockerfile.plc-dev
    └── scripts/  samples/  plugins/
```

## 1. Start the runtime (Docker)

Every PLC-touching feature needs the `openplc-plc-dev` container. The image is built
from source and is **self-contained** (no private images required):

```bash
cd runtime

# First time only: build the MatIEC-era OpenPLC base image.
# Upstream openplc-runtime's main has moved to STruC++ (which rejects MatIEC output),
# so this script pins a known MatIEC-era commit and builds `openplc-runtime-matiec:main`.
./scripts/build-matiec-base.sh

# Build + start the runtime (also builds the `rusty` plc checker from public source).
docker compose up -d --build   # idempotent; first build takes several minutes
# REST API: https://localhost:8443   (admin / admin123, self-signed cert)
```

> Requires Docker with BuildKit and network access (clones `autonomy-logic/openplc-runtime`
> at the pinned commit and `PLC-lang/rusty` at tag `v0.5.0`). On Apple Silicon the image
> runs under `--platform=linux/amd64` (Rosetta) automatically.

## 2. Build

```bash
npm install
npm run build               # tsc → dist/  (rebuild after editing src/)
npm test                    # 542 unit tests, no Docker needed
```

## 3. Use it — the CLI

`dist/cli.js` is a full command-line tool for driving OpenPLC from the terminal, no agent needed:

| Command | What it does |
|---|---|
| `status` | Quick runtime status (`status` / `isRunning` / `runtimeReachable`) |
| `compile <file>` | Compile an ST file, print the structured result JSON |
| `buildAndRun <file>` | Full deploy loop: compile → upload → start |
| `detectIO <file>` | Extract located IO (`AT` declarations) from ST |
| `readVariables [--names a,b]` | Read live variable values (cached `variableMap`) |
| `force --set start_btn=true` | Force / release inputs (also `--release`, `--pulseMs`, `--pulseScans`) |
| `trace --names led --durationMs 3000` | Sample variables over time (timers / state machines / counters) |
| `waitFor <var> <op> <value>` | Poll until a comparison holds (ops: `eq ne gt ge lt le`) |
| `verify <plan.json>` | Run a declarative verify plan; prints a JSON envelope |
| `genModbusConfig <file>` | Generate a `modbus_slave` plugin config from ST located IO |
| `genScene <file>` | Auto-suggest a process-simulation Scene Spec from ST IO |
| `serve [--lite]` | Run as an MCP stdio server instead (see §4) |

Run `node dist/cli.js <command> --help` for any command's options.

**Smoke test** (container up + `npm run build` done):

```bash
node dist/cli.js status                                            # → { status, isRunning, runtimeReachable }
node dist/cli.js compile runtime/samples/simple_counter_fixed.st   # → success: true, variableMap populated
node dist/cli.js compile runtime/samples/simple_counter.st         # → success: false (intentionally broken — exercises the error path)
```

## 4. Use it — as an MCP server

Point the agent workspace's `.sema/.mcp.json` at this package's `dist/cli.js`:

```json
{
  "mcpServers": {
    "plc-tools": {
      "transport": "stdio",
      "command": "node",
      "args": ["<repo>/sema-plc-tools/dist/cli.js", "serve", "--lite"],
      "env": { "PLC_URL": "https://localhost:8443", "PLC_CONTAINER": "openplc-plc-dev" }
    }
  }
}
```

`sema-plc-web` consumes this package directly (relative-imports `dist/`), so when you run the IDE it wires this MCP server up for you.

## 5. The 16 tools

| Group | Tools |
|---|---|
| Compile / check | `plc_check` (rusty syntax/semantic check; accepts a bare `FUNCTION_BLOCK`), `plc_compile` (matiec; errors carry `sourceLine` + `advice`) |
| Deploy / run | `plc_upload`, `plc_buildAndRun`, `plc_start`, `plc_stop`, `plc_status` |
| Observe | `plc_getLogs` (structured `runtimeErrors`), `plc_readVariables` (TIME/FB decode + runtime `tick`), `plc_trace` (time-series sampling), `plc_record` (scan-level recording; needs the recorder plugin), `plc_waitFor` (poll until a condition holds) |
| Interact / IO | `plc_forceVariables` (simulate `%IX` / `%IW` inputs), `plc_detectIO` (extract IO points from ST) |
| Verify / simulate | `plc_verifyBehavior` (declarative assertions), `plc_buildSimulation` (generate the process-simulation Scene Spec) |

`--lite` registers only: `plc_status`, `plc_readVariables`, `plc_getLogs`, `plc_detectIO`, `plc_buildSimulation`, `plc_stop` (verification then goes through the `verify` runner rather than ad-hoc tool calls).

The full I/O contract for every tool lives in [`src/types.ts`](src/types.ts).

## 6. Tests

```bash
npm test                    # 542 unit tests — no container needed
npm run test:integration    # full chain (compile → upload → start → readVariables → stop); needs the container running
```

The bundled samples make a quick manual check easy: `runtime/samples/simple_counter_fixed.st` compiles cleanly; `runtime/samples/simple_counter.st` is intentionally broken to exercise the structured error path; `runtime/samples/traffic_light.st` is a state-machine example.

## 7. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PLC_URL` | `https://localhost:8443` | OpenPLC Runtime REST API |
| `PLC_CONTAINER` | `openplc-plc-dev` | Docker container name |
| `PLC_USER` / `PLC_PASSWORD` | `admin` / `admin123` | Runtime credentials |
| `PLC_STATE_FILE` | `~/.plc-tools/state.json` | Shared state cache (`variableMap`, `zipPath`) |

Override any of them inline, e.g. `PLC_URL=https://192.168.1.100:8443 node dist/cli.js status`.
