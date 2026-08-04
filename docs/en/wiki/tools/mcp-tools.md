# MCP Tools Reference

`sema-plc-tools` exposes 16 composable PLC tools over MCP (stdio). The single source of truth for tool registration is the `TOOLS` constant in `sema-plc-tools/src/server.ts`; each tool's handler lives in `src/tools/*.ts`, and the I/O type contracts are in `src/types.ts`.

This page is a quick reference; for implementation mechanics see the deep-dive pages: [Compile and Deployment Pipeline](en/wiki/tools/compile-pipeline), [Syntax Check and IO Detection](en/wiki/tools/check-and-io), [Runtime Client and Debug Protocol](en/wiki/tools/runtime-client), [Observation and Verification Tool Semantics](en/wiki/tools/observation), [Declarative Verify Runner](en/wiki/tools/verify-runner), [Process Simulation and Scene Spec](en/wiki/tools/simulation), [State, Configuration, and Security Boundaries](en/wiki/tools/state-config).

Running as an MCP service:

```bash
cd sema-plc-tools
node dist/cli.js serve           # full set of 16 tools
node dist/cli.js serve --lite    # narrowed tool surface, see below
```

## Build and Deployment

| Tool | Function |
|---|---|
| `plc_compile` | Compiles ST source (iec2c → xml2st → ZIP), returning structured errors with line/column numbers and the offending source line |
| `plc_check` | Syntax/semantic check using the rusty (PLC-lang) compiler; accepts bare `FUNCTION_BLOCK`/`FUNCTION` (check only, no guarantee it runs on OpenPLC) |
| `plc_detectIO` | Purely offline scan of `AT %…` declarations, extracting the located IO surface (ST address, type, direction, OpenPLC Modbus mapping) |
| `plc_upload` | Uploads the last compiled ZIP to the OpenPLC Runtime and waits for GCC compilation, returning the full GCC log |
| `plc_buildAndRun` | Completes compile → upload → start in one call, returning structured per-stage results |

## Run Control

| Tool | Function |
|---|---|
| `plc_start` | Starts the loaded PLC program |
| `plc_stop` | Stops the running PLC program |
| `plc_status` | Gets the runtime status: `EMPTY` / `INIT` / `RUNNING` / `STOPPED` / `ERROR` |
| `plc_getLogs` | Gets the last N lines of runtime logs, with `hasRuntimeErrors` and `lastLine` |

## Observation and Verification

| Tool | Function |
|---|---|
| `plc_readVariables` | Reads variable values over the WebSocket debug protocol (names are case-insensitive; FB outputs use `instance.port`) |
| `plc_trace` | Samples variables over time to verify temporal "shape" (timer progression, state-machine rotation, counter monotonicity); ~50ms sampling floor |
| `plc_record` | Gets the recorder plugin's per-scan-cycle recording (20ms/frame), returning only change points; can see scan-level pulse widths/timing that trace cannot |
| `plc_waitFor` | Polls a single variable until a comparison condition holds or a timeout (replaces hand-written polling loops) |
| `plc_forceVariables` | Forces/releases variable values via DEBUG_SET to simulate inputs; supports `pulseMs`, `pulseScans` for tick-level verification, and conditional triggering with `when` |
| `plc_verifyBehavior` | Atomic behavior verification: force inputs → wait for a downstream condition → auto-release. Structurally enforces asserting a "persistent downstream effect", not a transient |

## Simulation

| Tool | Function |
|---|---|
| `plc_buildSimulation` | Generates/validates an animated process simulation (Scene Spec) for the running program, writing `scene.json` for the UI "Process Simulation" page to render |

## `--lite` Mode

`serve --lite` registers only 6 tools: `plc_status`, `plc_readVariables`, `plc_getLogs`, `plc_detectIO`, `plc_buildSimulation`, `plc_stop`.

Design intent: **physically remove** the verification-class tools from the MCP surface so that verification can only go through the declarative verify runner (see the `verify` command in [Standalone CLI](en/wiki/tools/cli)), closing off the old path where weak models fall back to manual "force → read" verification. The `.mcp.json` in the `sema-plc-web` workspace seed starts with `--lite` by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PLC_URL` | `https://localhost:8443` | OpenPLC Runtime address |
| `PLC_CONTAINER` | `openplc-plc-dev` | Container name |
| `PLC_USER` / `PLC_PASSWORD` | `admin` / `admin123` | Runtime credentials |
| `PLC_STATE_FILE` | `~/.plc-tools/state.json` | Caches `variableMap` and `zipPath` |
