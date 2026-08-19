# Frontend UI

The frontend is a Vite + React 18 application (`sema-plc-web/src/`). It receives backend pushes over WebSocket (`:3002`), and `/api/*` is proxied to `:3001`.

## Layout

Root component `src/App.tsx`: a `TopBar` on top, with a horizontal `PanelGroup` below -- **ChatPanel** on the left (collapsible, 35% by default) and **ArtifactCanvas** on the right. Two layout modes are supported, `split` / `columns` (persisted in localStorage).

Tabs of `ArtifactCanvas`:

| Area | Tab | Component | Content |
|---|---|---|---|
| Main | **code** | `center/CodeView.tsx` + `CodeEditor.tsx` | CodeMirror editor with ST syntax highlighting and a file tree |
| Main | **logic** | `center/LadderCanvas.tsx` + `LadderRungView.tsx` | Ladder diagram view (SVG rung cards drawn directly from the IR), colored by live variable values |
| Bottom | **process** | `sim/SimRuntime.tsx` | Process simulation animation |
| Bottom | **vars** | `right/VariableMonitor.tsx` | Live variable monitor (with a variable-count badge) |
| Bottom | **logs** | `layout/BottomLogs.tsx` | Runtime logs |

## Key Subsystems

### ST -> Ladder Transformer (`src/transformer/`)

`st-to-ladder.ts` converts ST source through an AST (`ast/`) into a ladder diagram intermediate representation (`ladder-ir/`); the current UI has `LadderRungView` render that IR directly as SVG. The full pipeline can continue through layout (`layout/`) -> React Flow nodes (`react-flow/`), with `live/` handling live-value coloring; the custom React Flow nodes live in `src/ladder-nodes/` (Contact / Coil / Timer / Counter / Comparator / PowerRail) and are currently not mounted in the UI.

### ST Language Support (`src/lang/`)

A Lezer-based ST grammar (`st.grammar`) provides CodeMirror syntax highlighting and auto-completion; `st-docs` provides documentation data, surfaced through the completion info panel (the earlier `st-hover` hover-tooltip module was removed in the language-service refactor).

### Chat Panel (`src/components/left/`)

`ChatPanel` + `PlanCard` + `blocks/` (ThinkingBlock / ToolCallCard / MarkdownText, etc.). Under `blocks/tools/` there are custom render cards for each class of tool call (Compile / Edit / Force / Read / Shell / Skill / Trace / Vars / Verify ...), registered and dispatched via `registry.tsx`.

### Process Simulation (`src/components/sim/`)

`SimRuntime.tsx` consumes the Scene Spec (`scene.json`) produced by `plc_buildSimulation`, laying out and animating the parts in `parts.tsx` / `partsCatalog.ts` (conveyor belts, water tanks, motors, etc.); `resolveEffect.ts` maps live PLC variable values to visual effects.

### State Management (`src/store/`)

zustand, split by domain: `agent` / `editor` / `engine` / `logs` / `model` / `plc` / `sim` / `workspace` (`engine` holds container-engine availability; it is not dispatched over WS, and the browser build stays at `unknown`). The WS client lives in `src/ws/client.ts`; it connects at startup and dispatches messages into the individual stores.

## Directory at a Glance

```
src/
├── App.tsx  main.tsx  theme.ts
├── components/
│   ├── layout/   TopBar / ArtifactCanvas / BottomLogs / ModelPanel
│   ├── left/     ChatPanel + blocks/ (incl. tools/ tool cards)
│   ├── center/   CodeView / CodeEditor / LadderCanvas / LadderRungView
│   ├── right/    VariableMonitor
│   └── sim/      SimRuntime / parts / partsCatalog / layout / resolveEffect
├── entries/      chat.tsx (VSCode sidebar entry, vite's second build input)
├── ladder-nodes/ ladder diagram React Flow custom nodes
├── transformer/  ST → ladder diagram pipeline
├── lang/         Lezer ST grammar + CodeMirror integration
├── models/       PLC and ladder-diagram data type definitions
├── store/        zustand stores
├── lib/          utilities (codeHighlight etc.)
├── i18n/         localization and scenario copy
├── styles/       stylesheets
└── ws/           WebSocket client
```
