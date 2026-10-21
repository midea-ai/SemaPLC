# Agent Plugin Support (QwenPaw · Claude Code · Cursor)

The 16 PLC tools in `sema-plc-tools` (and the full authoring workflow beyond the IDE's built-in Agent) now ship as three official plugin packages. All three share one authoritative skill file, [`skills/semaplc/SKILL.md`](https://github.com/midea-ai/SemaPLC/blob/main/skills/semaplc/SKILL.md), and launch MCP through one wrapper, [`scripts/semaplc-mcp.sh`](https://github.com/midea-ai/SemaPLC/blob/main/scripts/semaplc-mcp.sh) — which runs `npm install && npm run build` on first start when `dist/` is absent.

| Platform | Shape | Entry | Install |
|---|---|---|---|
| **QwenPaw** | `qwenpaw-plugin/` (plugin.json + plugin.py + skills + `/semaplc` command) | `/semaplc` in chat | `qwenpaw plugin install <repo>/qwenpaw-plugin` |
| **Claude Code** | repo root *is* the plugin: `.claude-plugin/` (plugin.json + marketplace.json), `.mcp.json`, `commands/semaplc.md`, `skills/` | `/plugin` marketplace | `/plugin marketplace add midea-ai/SemaPLC` → `/plugin install semaplc@semaplc` |
| **Cursor** | `.cursor/` (project rule + skill) + `cursor-plugin/install.sh` (global MCP installer) | ask the Agent a PLC question | `cd cursor-plugin && ./install.sh` |

## Shared prerequisites

- **Node.js ≥ 18** and **Docker** (the OpenPLC Runtime v4 container)
- The container is up: `cd sema-plc-tools/runtime && docker compose up -d --build` (or `docker start openplc-plc-dev`); REST at `https://localhost:8443`
- `dist/` is built on demand by the wrapper; on restricted networks run `cd sema-plc-tools && npm install && npm run build` yourself

## QwenPaw

The plugin follows QwenPaw's official plugin spec (`plugin.json` manifest + `plugin.py` backend):

- `api.register_skill_provider` injects the `semaplc` skill into every workspace (auto-cleaned on uninstall);
- `api.register_slash_command` registers `/semaplc`:
  - `/semaplc <requirement>` → the host agent runs the skill workflow (author → compile → run → verify → simulate);
  - `/semaplc status` → read-only probe of the local checkout and its build state;
  - `/semaplc mcp` → prints the MCP config JSON with the path already resolved.

QwenPaw's MCP clients are managed by the console (Agent → MCP → + create); the plugin never writes that config for you. Paste the `/semaplc mcp` output, or start from [`qwenpaw-plugin/mcp/semaplc.mcp.json`](https://github.com/midea-ai/SemaPLC/blob/main/qwenpaw-plugin/mcp/semaplc.mcp.json). Set `SEMAPLC_REPO=<path>` when the checkout is not in a default location.

```bash
qwenpaw plugin install <repo>/qwenpaw-plugin
qwenpaw plugin validate <repo>/qwenpaw-plugin   # CI check
```

## Claude Code

The repository root doubles as the plugin root (`source: "./"`), and `.claude-plugin/marketplace.json` makes the same repo its own marketplace. Install in a session:

```
/plugin marketplace add midea-ai/SemaPLC
/plugin install semaplc@semaplc
```

Then describe a control requirement: `/semaplc traffic light — red 30s, green 25s, yellow 4s, repeating`.

Components: `.mcp.json` registers the `semaplc` MCP server (`command: bash`, args `${CLAUDE_PLUGIN_ROOT}/scripts/semaplc-mcp.sh serve`); `commands/semaplc.md` provides the `/semaplc` workflow command; `skills/semaplc` is the skill (declared via `"skills": "./skills/"`).

> Verified install path: `claude mcp list` shows `plugin:semaplc:semaplc … ✔ Connected` from any working directory (`${CLAUDE_PLUGIN_ROOT}` expands correctly). The `.mcp.json` uses the `mcpServers` wrapper so it also *parses* when the repository is opened as a plain project — there, the entry appears as "pending approval" with a `CLAUDE_PLUGIN_ROOT` missing warning (project mode has no such variable). Do not approve it; register with `claude mcp add semaplc -- bash <repo>/scripts/semaplc-mcp.sh serve` instead.

## Cursor

Cursor's `mcp.json` does **not** support `${workspaceFolder}`, so there are two routes:

1. **Global installer (recommended):** `cursor-plugin/install.sh` idempotently merges the `semaplc` entry (absolute path + wrapper) into `~/.cursor/mcp.json` — timestamped backup, other servers and existing `env` keys preserved — and copies the skill to `~/.cursor/skills/semaplc/`. `--dry-run` previews, `--remove` uninstalls.
2. **Project-level:** copy `cursor-plugin/mcp.json` (which uses `${env:SEMAPLC_REPO}` expansion) to the project's `.cursor/mcp.json`; for a GUI-launched Cursor that cannot see your shell variables, replace the placeholder with the absolute path.

The repo's own `.cursor/rules/semaplc.mdc` and `.cursor/skills/semaplc/` are active the moment Cursor opens this repository (triggered by description/globs, not always-on).

## Skill-copy consistency

`skills/semaplc/` is the source of truth; the other two copies are distribution mirrors:

```bash
scripts/sync-plugin-skills.sh          # sync
scripts/sync-plugin-skills.sh --check  # CI check (all three identical)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| MCP server never starts | Run `bash <repo>/scripts/semaplc-mcp.sh status` — it prints JSON (and completes the first-start build); then check the container: `docker ps | grep openplc-plc-dev` |
| Claude reports the `semaplc` MCP file not found | You opened the repo as a project and reused the plugin `.mcp.json`; register with `claude mcp add` per the note above |
| Cursor's MCP panel shows no tools | Confirm you edited `~/.cursor/mcp.json` (global) or the project `.cursor/mcp.json`; restart Cursor or reconnect the server in Settings |
| QwenPaw `/semaplc` says no repository | `export SEMAPLC_REPO=/path/to/SemaPLC` (visible to the QwenPaw process) |
| Several agents sharing one PLC state | By design: the cache lives at `~/.plc-tools/state.json`; set `PLC_STATE_FILE` to isolate (see [State, Config & Safety Boundaries](en/wiki/tools/state-config)) |

Full per-tool I/O contracts: [MCP Tools Reference](en/wiki/tools/mcp-tools); the narrowed `serve --lite` surface is covered in [Standalone CLI](en/wiki/tools/cli) and the toolchain README.
