# Syntax Check and IO Detection

This page covers three analysis tools that never touch the runtime (or are read-only): `plc_check` (rusty syntax/semantic check), `plc_detectIO` (offline IO scan), and `genModbusConfig` (Modbus slave configuration generation). For how they relate to the compile-and-deploy chain see [Compile and Deployment Pipeline](en/wiki/tools/compile-pipeline); for the tool inventory see [MCP Tools Reference](en/wiki/tools/mcp-tools).

## plc_check: Fast Checking with rusty

Entry point `handleCheck` (`src/tools/check.ts`). This is a **different compiler** from the matiec used by `plc_compile`: check goes through [rusty](https://github.com/PLC-lang/rusty) (the `plc` command inside the container), runs `--check` only, and produces no runtime artifacts whatsoever.

### Invocation

`realCheckExec` `docker cp`s the ST source into the container, then assembles one command inside it:

```bash
STD=$(ls /opt/iec61131-stdlib/*.st 2>/dev/null | grep -Ev "bit_conversion|string_conversion|string_functions|extra_functions")
plc --check /tmp/plc-check-XXXXXX.st $STD 2>&1
```

The landing path inside the container is **randomized per call** (it reuses the already-randomized `mkdtemp` directory name as the file name, e.g. `/tmp/plc-check-XXXXXX.st`, removed with `rm -f` in the finally block): an earlier version hard-coded `/tmp/plc_check_input.st`, so two concurrent `handleCheck` calls would overwrite each other's source and attach A's diagnostics to B's code — since fixed.

The remaining implementation details all have a reason:

- **Include stdlib declarations**: the standard-function `.st` declarations under `PLC_CHECK_STDLIB_DIR` (default `/opt/iec61131-stdlib`) are passed in alongside the user code; otherwise calls to `TON`, type conversion functions, etc. in user code would be falsely reported as undefined;
- **Exclude 4 files**: `SKIP_STDLIB = ['bit_conversion', 'string_conversion', 'string_functions', 'extra_functions']` — these files make rusty v0.5.0's `--check` panic outright and must be removed from the declaration set;
- **`2>&1` stream merge**: rusty's diagnostics go to stderr; after merging, everything is parsed uniformly from stdout, with the exit code captured separately.

The verdict rule in one sentence: **`ok ⇔ plc --check exit code is 0`**. When the exit code is non-zero but no diagnostics can be parsed (e.g. `plc` is not even installed in the container), an `errorMessage` is returned identifying it as an infrastructure problem rather than a code problem — this is why `errors` and `errorMessage` are separate in `CheckResult` (`src/types.ts`): the former means code errors, the latter means environment errors.

### Why a Bare FUNCTION_BLOCK Passes

rusty treats the input as an ordinary compilation unit and does not require a `PROGRAM`/`CONFIGURATION` skeleton — so a snippet containing only `FUNCTION_BLOCK ... END_FUNCTION_BLOCK` can be checked. This lets an agent incrementally check a single function block **before** assembling the full program, which is the core use of check.

### Differences from OpenPLC Runnability

The tool description in `src/server.ts` is blunt about it: "passing does NOT mean it runs on OpenPLC". Sources of the difference:

| Dimension | plc_check (rusty) | plc_compile / buildAndRun (matiec) |
|---|---|---|
| Accepts bare FUNCTION_BLOCK | Yes | No, requires a full PROGRAM + CONFIGURATION |
| Dialect strictness | The same compiler used for benchmark evaluation, so passing check means alignment with the evaluation baseline | Has its own quirks (`END_IF;` must carry a semicolon, AT and non-AT variables cannot share a block, etc.; see the error pattern table in [Compile and Deployment Pipeline](en/wiki/tools/compile-pipeline)) |
| Semantic gates | None | Dead-output hard gate (declared `%Q` must be assigned) |
| Artifacts | None (check-only) | ZIP + variableMap, ready to upload and run |

So the correct workflow is: use check for fast iteration, but a program still has to pass `plc_buildAndRun` before it counts as "runnable".

### The Output Structure of rustyErrorParser

rusty emits codespan-style colored diagnostics. `parseRustyErrors` (`src/tools/rustyErrorParser.ts`) first strips SGR color codes with `stripAnsi`, then does a two-part match: an `error[Exxx]: message` head line, and a `┌─ <file>:<line>:<col>` location line **within at most 3 lines** after it:

```ts
const headRe = /error\[(E\d+)\]:\s*(.+?)\s*$/
const locRe = /┌─\s*(.+?):(\d+):(\d+)/
```

Each match produces a `RustyError { code, message, line, col, file? }`; when the location line is missing, `line`/`col` are `null` (the error is kept, only the position is lost). The path is **captured**, not skipped: a single `plc --check` run checks a dozen stdlib `.st` files alongside the user code, and most errors may come from `/opt/iec61131-stdlib/*.st` — the `file` field lets consumers tell stdlib errors from user-code errors (path not under `checkStdlibDir` ⇔ user code). `CheckResult.raw` retains the full de-colored output as a fallback for the agent to read when the structured fields are not enough.

## plc_detectIO: Offline IO Scan

`detectIO` (`src/tools/detectIO.ts`) is a pure function with zero dependencies — it starts no compiler and touches no Docker, directly regex-scanning the `AT` located declarations in the ST source:

```ts
const AT_DECL_RE = /(\w+)\s+AT\s+(%[IQM][XBWDL]\d[\d.]*)\s*(?::\s*([A-Za-z_]\w*))?/gi
```

Design rationale: the `AT` declarations are the **authoritative source of truth** for located IO — matiec's `LOCATED_VARIABLES.h` is itself derived from them, so the offline scan necessarily agrees with the compile artifacts. For duplicate declarations of the same name, the first occurrence wins, preserving source order.

Each entry infers:

| Field | Rule |
|---|---|
| `direction` | Second character of the address: `I` → `input`, `Q` → `output`, `M` → `memory` |
| `type` | The `: TYPE` part of the declaration, defaulting to `''` |
| `modbusType` / `modbusAddr` | Per the OpenPLC mapping rules (table below); `null` when there is no counterpart, but **the entry is still kept** — the caller sees the complete IO surface, just without a Modbus channel |

### OpenPLC Modbus Address Mapping

The rules implemented by `mapModbus` (annotated OpenPLC §10.3 in the source comments):

| IEC address class | Modbus type | Address calculation | Example |
|---|---|---|---|
| `%IX<byte>.<bit>` | `discrete_input` | `byte * 8 + bit` | `%IX0.3` → 3, `%IX1.0` → 8 |
| `%QX<byte>.<bit>` | `coil` | `byte * 8 + bit` | `%QX0.0` → 0 |
| `%IW<n>` | `input_register` | `n` | `%IW2` → 2 |
| `%QW<n>` | `holding_register` | `n` | `%QW0` → 0 |
| `%M*`, `%IB/%QB`, `%ID/%QD` etc. | `null` | — | Memory areas and byte/double-word forms have no Modbus equivalent |

The `byte*8+bit` conversion for bit-class addresses is OpenPLC's buffer layout convention: each byte address occupies 8 consecutive bit positions, so `%IX1.0` starts at bit 8.

### Dead-Output Detection (Shared with compile's Semantic Gate)

`findUnassignedOutputs` in the same file filters the `detectIO` result: any name with `direction === 'output'` for which no `\b<name>\b\s*:=` can be found in the program body (comments stripped first via `stripStComments`, to prevent `:=` inside comments from misfiring) is a dead output. `plc_compile` uses it as a pre-compile hard gate — details in [Compile and Deployment Pipeline](en/wiki/tools/compile-pipeline).

### The io_map.yaml Hint Layer

`src/tools/ioMap.ts` provides an optional semantic hint layer: an `io_map.yaml` in the project supplies `component` / `label` keyed by ST symbol name, and `applyIoMap` fills `component` into `DetectedIO`. When `component` is set, it **takes precedence over the variable-name heuristics** in component selection (the simulation rendering of `suggestScene` / `buildSimulation`). `parseIoMap` is fully fault-tolerant: an empty file, invalid YAML, or a non-object structure all return `{}` — the hint layer is optional and never fatal.

## genModbusConfig: modbus_slave Plugin Configuration

`buildModbusSlaveConfig` (`src/tools/modbusConfig.ts`) converts the `detectIO` result into the configuration for the OpenPLC modbus_slave plugin (the schema is aligned with the fields actually consumed by `simple_modbus.py` in the runtime):

```json
{
  "network_configuration": { "host": "0.0.0.0", "port": 502 },
  "buffer_mapping": {
    "coils":             { "qx_bits": 8 },
    "discrete_inputs":   { "ix_bits": 4 },
    "holding_registers": { "qw_count": 2 },
    "input_registers":   { "iw_count": 1 }
  }
}
```

The size of each block is computed by `sizeFor`: the **maximum address + 1** within that Modbus type (exactly covering all detected addresses), or 0 when there are no entries; entries without a Modbus mapping (`%M*` etc.) do not participate. A slave generated this way exposes no excess address space.

Two usage paths:

1. **Manual CLI generation**: `node dist/cli.js genModbusConfig program.st [--host] [--port]` (see [Standalone CLI](en/wiki/tools/cli)), outputting JSON for you to deploy yourself;
2. **Automatic injection at compile time**: with `PLC_MODBUS_PORT` set, `handleCompile` appends the configuration into the program ZIP as `conf/modbus_slave.json` after a successful compile (`realInjectModbusConf` in `src/tools/compile.ts`, appended in-container via `zip -q`). OpenPLC's plugin rule at upload time is "only plugins with a same-named json under `conf/` get enabled", so this single file makes the upload automatically enable the Modbus TCP slave — SCADA systems like FUXA can then read the running program's `%QX/%QW` directly. Off by default (no injection unless the environment variable is set).
