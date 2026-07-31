# Project Overview

**Sema PLC** turns a natural-language control requirement into a running PLC program. Type a task into the chat panel — *"latch a motor when the start button is pressed and a 3-second timer elapses"* — and the embedded [sema-core](https://github.com/midea-ai/sema-code-core) Agent will:

1. Write IEC 61131-3 Structured Text (ST)
2. Compile it (matiec: ST → C → GCC → `.so`)
3. Deploy it to a live [OpenPLC Runtime](https://openplcproject.com/)
4. Behavior-verify it — force `%I` inputs and trace variables over time to prove timers / state-machines / counters actually behave as specified, not just that the code compiles
5. Render the result as a **ladder diagram + live variables + process simulation**

## Two Packages That Work Together

| Package | Role |
|:--------|:-----|
| **`sema-plc-web`** | The Agent-driven IDE. A localhost web app (React 18 + Vite frontend, Node backend) that embeds the sema-core Agent and visualizes ST → ladder + live vars + process simulation + tool-call log. |
| **`sema-plc-tools`** | The PLC toolchain that makes the IDE work. Both an agent-driven **MCP server** and a **standalone CLI**; it covers the full loop (syntax-check → compile → upload → run → read / force / trace variables), and ships the OpenPLC Runtime Docker environment. |

The two packages are independent npm packages (not a workspace); `sema-plc-web` imports the `dist/` of `sema-plc-tools` directly via a relative path.

## Features

| Feature | Description |
|:--------|:------------|
| **Natural-language → running PLC** | The Agent generates, compiles, deploys, and verifies the ST program end-to-end. |
| **Live ladder diagram** | Generated ST is transformed into a ladder-logic view (React Flow) that reflects live runtime variable values. |
| **Behavior verification** | Forced inputs + timed traces verify real behavior, not just successful compilation. |
| **Process simulation** | A native Scene-Spec simulation animates a plant model (conveyors, tanks, motors) driven by live PLC values. |
| **MCP server + CLI** | 16 composable tools — usable by any MCP-capable agent, or directly from the terminal. |
| **OpenPLC Runtime v4** | Real IEC 61131-3 execution, packaged as a one-command Docker environment. |

## Privacy and License

Everything runs on `localhost` — your code and your LLM key never leave your machine except for the model API calls you configure.

Sema PLC's own code is released under the MIT License; it drives a GPL/LGPL PLC toolchain (matiec, rusty, OpenPLC) as separate command-line binaries built into the Docker image, so their copyleft does not extend to the MIT source. See `THIRD_PARTY_NOTICES.md` in the repository for details.

## Acknowledgments

- Built on [OpenPLC](https://openplcproject.com/) Runtime v4 + the [matiec](https://github.com/nucleron/matiec) IEC 61131-3 compiler
- The embedded LLM Agent runtime is [sema-code-core](https://github.com/midea-ai/sema-code-core); WebSocket-gateway and embedded-Agent patterns are adapted from [SemaClaw](https://github.com/midea-ai/SemaClaw)
- The ladder-diagram renderer is lifted from [cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor) (MIT)
