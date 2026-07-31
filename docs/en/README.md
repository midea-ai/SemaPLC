<p align="center">
  <img src="images/semaplc.jpg" alt="Sema PLC logo" width="420" />
</p>

<p align="center">
  <em>An Agent-driven IDE for industrial PLC programming — describe a control task in natural language, watch it become a running IEC 61131-3 program.</em>
</p>

---

## 📖 Overview

**Sema PLC** turns a natural-language control requirement into a running PLC program. Type a task into the chat panel — *"latch a motor when the start button is pressed and a 3-second timer elapses"* — and an embedded [sema-core](https://github.com/midea-ai/sema-code-core) Agent writes IEC 61131-3 Structured Text (ST), compiles it, deploys it to a live [OpenPLC Runtime](https://openplcproject.com/), behavior-verifies it (force inputs, trace variables), and renders the result as a ladder diagram + live variable values + a process simulation.

The repository ships two products that work together:

| Package | Role |
|:--------|:-----|
| **`sema-plc-web`** | The Agent-driven IDE. A localhost web app (React + Vite frontend, Node backend) that embeds the sema-core Agent and visualizes ST → ladder + live vars + process simulation + tool-call log. |
| **`sema-plc-tools`** | The PLC toolchain that makes the IDE work. Usable two ways — as an **MCP server** an agent drives, or as a **standalone CLI** you run from the terminal — it covers the full loop (syntax-check → compile → upload → run → read / force / trace variables), and ships the OpenPLC Runtime Docker environment. |

## ✨ Features

| Feature | Description |
|:--------|:------------|
| **Natural-language → running PLC** | Describe control logic in plain language; the Agent generates, compiles, deploys, and verifies the ST program end-to-end. |
| **Live ladder diagram** | Generated ST is transformed into a ladder-logic view (React Flow) that reflects live runtime variable values. |
| **Behavior verification** | The Agent forces `%I` inputs and traces variables over time to prove timers / state-machines / counters actually behave as specified — not just that the code compiles. |
| **Process simulation** | A native Scene-Spec simulation animates a plant model (conveyors, tanks, motors) driven by live PLC values. |
| **MCP server + CLI** | 16 composable tools (`plc_check`, `plc_compile`, `plc_buildAndRun`, `plc_readVariables`, `plc_forceVariables`, `plc_trace`, ...). |
| **OpenPLC Runtime v4** | Real IEC 61131-3 execution via OpenPLC + matiec, packaged as a one-command Docker environment. |

## 🏗 Architecture

```
Browser (Vite + React 18, :5173)
  │  /api/* (proxied to :3001)        WebSocket → ws://localhost:3002
  ▼
sema-plc-web backend (:3001 HTTP + :3002 WS)
  ├── sema-bridge      embeds SemaCore, runs the Agent
  ├── plc-controller   user-triggered Run / Stop
  └── plc-monitor      live variable polling
          │  direct import
          ▼
sema-plc-tools (dist/)  ──MCP/REST──►  OpenPLC Runtime v4  (Docker, :8443)
   ST → matiec → C → GCC → .so → execution
```

The Agent reasons over the MCP tools in `sema-plc-tools`; the same tools back the IDE's Run/Stop buttons and live-variable panel. Everything runs on `localhost` — your code and your LLM key never leave your machine except for the model API calls you configure.

## 🚀 Start Here

- [Quick Start](en/wiki/getting-started/quick-start) — install, build, and bring up the IDE with one command
- [Architecture](en/wiki/overview/architecture) — how the components work together
- [MCP Tool Reference](en/wiki/tools/mcp-tools) — the full reference for the 16 PLC tools
- [Standalone CLI](en/wiki/tools/cli) — drive OpenPLC directly, no agent required
