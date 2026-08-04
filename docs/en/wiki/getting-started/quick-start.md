# Quick Start

## Prerequisites

- **Node.js ≥ 18** and **npm**
- **Docker** (Docker Desktop on macOS / Windows) — for the OpenPLC Runtime container
- An **LLM API key** (DeepSeek recommended; see [Model Configuration](en/wiki/getting-started/model-config) for the full list of supported providers)

## Install

```bash
# 1. Clone
git clone https://github.com/midea-ai/SemaPLC.git
cd SemaPLC

# 2. Build the toolchain (the web app direct-imports its dist/)
cd sema-plc-tools && npm install && npm run build && cd ..

# 3. Build the OpenPLC runtime base image (first time only; needs Docker + network)
#    Upstream openplc-runtime's main moved to STruC++; this pins a MatIEC-era commit.
( cd sema-plc-tools/runtime && ./scripts/build-matiec-base.sh )

# 4. Install the web app (sema-core is vendored in sema-plc-web/vendor/, installed via a file: dep)
cd sema-plc-web && npm install

# 5. Configure your LLM key
cp .env.example .env
#   edit .env and fill in one key, e.g. DEEPSEEK_API_KEY=sk-...
```

## Run (One Command)

`sema-plc-web/dev.sh` brings up everything with one command:

```bash
# from sema-plc-web/
./dev.sh                        # default: PLC_MODEL=deepseek
PLC_THINKING=0 ./dev.sh         # recommended for deepseek: disable thinking (its 8192 output cap truncates easily)
PLC_MODEL=minimax-m2.7 ./dev.sh
```

It does 5 things in order:

1. Checks/starts the Docker daemon (auto `open -a Docker` on macOS, waits up to 120s)
2. Idempotently starts the `openplc-plc-dev` container (skip if running, `docker start` if stopped, compose up only if absent)
3. Rebuilds `sema-plc-tools`
4. Kills stale processes on ports 3001/5173
5. Sources `.env`, then launches the dev server (frontend + backend)

> Note: `dev.sh` defaults the workspace to `/tmp/plc-ver-ws`; manual startup defaults to `~/plc-workspace` (override with the `WORKSPACE` environment variable or `--workspace`).

When it's up you'll see:

```
[SERVER] HTTP ready on http://127.0.0.1:3001
[SERVER] WS ready on ws://127.0.0.1:3002
[SERVER] [plc-tools] MCP server ready
[VITE]   ➜  Local:   http://localhost:5173/
```

Open **<http://localhost:5173>** and describe a control requirement in the chat panel.

> First run builds the OpenPLC Docker image (incl. the `rusty` checker from source), which can take several minutes. The container exposes its REST API on `https://localhost:8443` with a self-signed certificate.

## Manual Step-by-Step Startup

```bash
# 1. Start the OpenPLC runtime
( cd sema-plc-tools/runtime && docker compose up -d --build )

# 2. Build the toolchain
( cd sema-plc-tools && npm run build )

# 3. Start the dev server (concurrently: backend tsx watch + frontend vite)
( cd sema-plc-web && npm run dev )
```

## Tests

```bash
cd sema-plc-tools && npm test     # unit tests, no Docker needed
cd sema-plc-tools && npm run test:integration   # integration tests, container must be running
cd sema-plc-web   && npm test     # server: vitest/node, frontend: vitest/jsdom
```
