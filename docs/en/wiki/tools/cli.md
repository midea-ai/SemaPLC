# Standalone CLI

Besides serving as an MCP service, `sema-plc-tools` is itself a full command-line tool (bin name `plc-tools`, entry point `src/cli.ts`, built on commander) — it can drive OpenPLC directly from a terminal with no agent involved.

Prerequisites: run `npm run build` in `sema-plc-tools/` first, and make sure the runtime container is up (see [OpenPLC Runtime Environment](en/wiki/tools/runtime)).

## Common Commands

```bash
cd sema-plc-tools
node dist/cli.js status                                # runtime status (exit 0 when running)
node dist/cli.js compile program.st                    # compile and print structured result JSON
node dist/cli.js buildAndRun program.st                # compile -> upload -> start
node dist/cli.js readVariables --names led,motor       # read live variable values
node dist/cli.js trace --names led --durationMs 3000   # sample a variable over time
node dist/cli.js force --set start_btn=true            # simulate an input
node dist/cli.js waitFor red_led eq true               # poll until the condition holds
node dist/cli.js verify plan.json                      # run a declarative verify plan
node dist/cli.js serve                                 # run as an MCP stdio server instead
```

## All Subcommands

| Command | Description / main options |
|---|---|
| `serve [--lite]` | Runs as an MCP stdio server; `--lite` narrows the tool surface |
| `verify <planFile> [--only <caseName>]` | Runs a declarative verify plan (build → drive cases → assert → cleanup), printing a JSON envelope to stdout; the runner lives in `src/verify/` |
| `status` | Quick status check |
| `compile <file>` | Compiles an ST file and prints structured JSON |
| `detectIO <file>` | Extracts `AT` located IO and prints the IO map |
| `genModbusConfig <file> [--host] [--port]` | Generates modbus_slave plugin configuration from located IO (default `0.0.0.0:502`) |
| `readVariables [--names] [--timeoutMs]` | Reads live variable values |
| `buildAndRun <file>` | Full deployment loop: compile → upload → start |
| `force [--set n=v,…] [--release] [--pulseMs] [--pulseScans] [--timeoutMs]` | Forces/releases variables |
| `trace [--names] [--intervalMs] [--durationMs] [--samples] [--timeoutMs]` | Time-series sampling |
| `waitFor <varName> <op> <value> [--timeoutMs] [--intervalMs]` | Polls until the condition holds; op supports the shell-friendly `eq ne gt ge lt le`, and also accepts quoted `== != > >= < <=` |
| `genScene <file>` | Auto-suggests a process-simulation Scene Spec from the ST located IO |

## Declarative Verification (verify plan)

The `verify` command consumes a JSON plan file and runs the full "build → drive inputs per case → assert → cleanup" flow, emitting the result as a structured JSON envelope on stdout, suitable for consumption by CI and agents. The runner implementation is in `sema-plc-tools/src/verify/` (`runner.ts` / `caseExec.ts` / `planParse.ts`, etc.).

For the plan schema, see `sema-plc-web/templates/.sema/skills/plc-build-and-verify/plan-schema.md`.
