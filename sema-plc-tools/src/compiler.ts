import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { CompileResult, Iec2cError } from './types.js'
import { adviceForIec2cError } from './tools/iec2cErrorParser.js'
import { dockerBin } from './config.js'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type ExecFn = (
  stCode: string,
  container: string,
) => Promise<ExecResult>

// Parse matiec error format. Real matiec emits: file:line-col..line-col: severity: message
// Older/alternate form: file:line:col-line:col: severity: message — both accepted.
export function parseIec2cErrors(stderr: string, stCode?: string): Iec2cError[] {
  // 末端行列一直在匹配范围内,只是以前用 \d+ 吞掉没捕获。捕出来诊断的波浪线才能盖住整个
  // token,否则只能退化成 col 处的一个点。
  const pattern = /^\S+:(\d+)[-:](\d+)(?:\.\.|-)(\d+)[-:](\d+):\s+(error|warning):\s+(.+)$/gm
  const srcLines = stCode?.split('\n')
  const errors: Iec2cError[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(stderr)) !== null) {
    const line = parseInt(m[1], 10)
    const message = m[6].trim()
    const sourceLine = (srcLines?.[line - 1] ?? '').replace(/\r$/, '')
    const advice = adviceForIec2cError(message, sourceLine)
    errors.push({
      line,
      col: parseInt(m[2], 10),
      endLine: parseInt(m[3], 10),
      endCol: parseInt(m[4], 10),
      severity: m[5] as 'error' | 'warning',
      message,
      sourceLine,
      ...(advice ? { advice } : {}),
    })
  }
  return errors
}

// Build the inline compilation script as an array of lines to avoid
// TypeScript template-literal interpretation of bash ${...} expressions.
//
// webserver/plcapp_management.py::update_plugin_configurations() is called on
// every upload.  It scans core/generated/conf/*.json, strips the extension,
// and matches the stem against plugin.name from plugins.conf.  When conf/ is
// absent (or a plugin has no matching .json) the plugin is disabled.  The
// recorder plugin is always-on by design, so we must include conf/recorder.json
// in every ZIP to survive the upload without being silently disabled.
// Exact rule (plugin_config_model.py::update_plugins_from_config_dir):
//   available_configs = { stem(f): f for f in glob(conf_dir + "/*.json") }
//   plugin.enabled = plugin.name in available_configs
function makeCompileScript(): string {
  return makeCompileScriptLines().join('\n')
}

function makeCompileScriptLines(): string[] {
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'ST_FILE="${1?}"',
    'WORK_DIR=$(mktemp -d /tmp/plc_compile_XXXXXX)',
    'cd "$WORK_DIR"',
    'cp "$ST_FILE" program.st',
    'ln -sf /usr/local/share/matiec/lib lib',
    '',
    'iec2c -f -p -i -l program.st > iec2c.log 2>&1 || {',
    '  cat iec2c.log >&2; exit 1',
    '}',
    '# Emit iec2c.log on success too, so matiec warnings reach the caller (stdout',
    '# stays clean — only the ZIP path is echoed there; warnings go to stderr).',
    'cat iec2c.log >&2',
    '',
    '# Verify iec2c generated the expected output files',
    'for f in Config0.c Config0.h Res0.c POUS.c POUS.h LOCATED_VARIABLES.h VARIABLES.csv; do',
    '  [ -f "$f" ] || { echo "iec2c missing output: $f" >&2; exit 1; }',
    'done',
    '',
    'xml2st --generate-debug program.st VARIABLES.csv > /dev/null 2>&1 || {',
    '  echo "xml2st_debug_failed" >&2; exit 2',
    '}',
    '',
    'xml2st --generate-gluevars LOCATED_VARIABLES.h > /dev/null 2>&1 || {',
    '  echo "xml2st_gluevars_failed" >&2; exit 3',
    '}',
    '',
    "cat > c_blocks_code.cpp << 'EOF'",
    'extern "C" {}',
    'EOF',
    "cat > c_blocks.h << 'EOF'",
    '#ifndef C_BLOCKS_H',
    '#define C_BLOCKS_H',
    '#endif',
    'EOF',
    '',
    'rm -f lib',
    'cp -r /usr/local/share/matiec/lib ./lib',
    '',
    '# Inject conf/recorder.json so update_plugin_configurations() keeps the',
    '# recorder plugin enabled after upload (empty object is a valid config).',
    'mkdir -p conf',
    'echo "{}" > conf/recorder.json',
    '',
    '# Place ZIP inside the work dir so dirname(zipPath) resolves to the actual',
    '# compile artifacts (VARIABLES.csv, LOCATED_VARIABLES.h, etc.) on the host side.',
    'ZIP_PATH="$WORK_DIR/plc_program_$(date +%s).zip"',
    'zip -r "$ZIP_PATH" Config0.c Config0.h Res0.c POUS.c POUS.h LOCATED_VARIABLES.h \\',
    '    VARIABLES.csv debug.c glueVars.c c_blocks_code.cpp c_blocks.h lib/ conf/ > /dev/null',
    'echo "$ZIP_PATH"',
  ]
}

/** Exported for unit testing only — returns the compile script source. */
export function makeCompileScriptForTest(): string {
  return makeCompileScriptLines().join('\n')
}

async function realExec(stCode: string, container: string): Promise<ExecResult> {
  const bin = dockerBin()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-host-'))
  const stFile = path.join(tmpDir, 'program.st')
  const scriptFile = path.join(tmpDir, 'compile.sh')

  try {
    fs.writeFileSync(stFile, stCode, 'utf8')
    fs.writeFileSync(scriptFile, makeCompileScript(), { mode: 0o755 })

    // Copy ST file and script into container
    await execFileAsync(bin, ['cp', stFile, `${container}:/tmp/program_input.st`])
    await execFileAsync(bin, ['cp', scriptFile, `${container}:/tmp/plc_compile.sh`])
    await execFileAsync(bin, ['exec', container, 'chmod', '+x', '/tmp/plc_compile.sh'])

    const { stdout, stderr } = await execFileAsync(
      bin,
      ['exec', container, '/tmp/plc_compile.sh', '/tmp/program_input.st'],
      // timeout:docker/容器卡死时不无限挂起(matiec 编译正常秒级;挂死曾把整个
      // buildAndRun 拖到外部 SIGTERM,真因被误报成 interrupted)。
      { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
    ).catch((err: any) => {
      throw Object.assign(err, { exitCode: err.code ?? 1 })
    })

    return { stdout: stdout.trim(), stderr, exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr ?? String(err),
      exitCode: err.exitCode ?? 1,
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function runCompileChain(
  stCode: string,
  container: string,
  execFn: ExecFn = realExec,
): Promise<CompileResult> {
  const { stdout, stderr, exitCode } = await execFn(stCode, container)

  if (exitCode !== 0) {
    const parsed = parseIec2cErrors(stderr, stCode)
    const errors = parsed.filter(e => e.severity === 'error')
    const warnings = parsed.filter(e => e.severity === 'warning')
    // Bash script exits: 1=iec2c, 2=xml2st_debug, 3=xml2st_gluevars, 4=missing output files
    const isXml2stDebug = exitCode === 2 || stderr.includes('xml2st_debug_failed')
    const isXml2stGlue = exitCode === 3 || stderr.includes('xml2st_gluevars_failed')

    const failedStage = isXml2stGlue
      ? 'xml2st_gluevars'
      : isXml2stDebug
      ? 'xml2st_debug'
      : 'iec2c'

    // ~31% of real failures produce no line-level diagnostics (e.g. matiec
    // bails out on a fatal syntax error). In that case surface the raw stderr
    // (truncated) so the agent isn't left blind — errors[] would be empty.
    let errorSummary: string
    if (errors.length > 0) {
      errorSummary = `iec2c error at line ${errors[0].line}: ${errors[0].message}`
    } else {
      const raw = stderr.trim().slice(0, 500)
      if (/Parsing failed|Bailing out/i.test(stderr)) {
        errorSummary = `iec2c bailed out on a fatal syntax error (no line-level diagnostics). Check for a misspelled keyword (CONFIGURATION/PROGRAM/END_IF/END_VAR), a missing or extra END_*, or stray characters. Raw: ${raw}`
      } else if (raw) {
        errorSummary = `${failedStage} failed: ${raw}`
      } else {
        errorSummary = `${failedStage} failed. Check stderr for details.`
      }
    }

    return {
      success: false,
      failedStage,
      iec2c: { success: failedStage !== 'iec2c', errors, warnings, generatedFiles: [] },
      xml2st: {
        debugSuccess: !isXml2stDebug,
        glueVarsSuccess: !isXml2stGlue,
        errors: isXml2stDebug || isXml2stGlue ? [stderr] : [],
      },
      variableMap: [],
      zipPath: null,
      errorSummary,
    }
  }

  const zipPath = stdout.split('\n').find(l => l.startsWith('/tmp/')) ?? null
  const warnings = parseIec2cErrors(stderr, stCode).filter(e => e.severity === 'warning')

  return {
    success: true,
    failedStage: null,
    iec2c: {
      success: true,
      errors: [],
      warnings,
      generatedFiles: ['Config0.c', 'Res0.c', 'POUS.c', 'LOCATED_VARIABLES.h', 'VARIABLES.csv'],
    },
    xml2st: { debugSuccess: true, glueVarsSuccess: true, errors: [] },
    variableMap: [],   // populated by compile tool after reading VARIABLES.csv
    zipPath,
    errorSummary: 'Compilation successful.',
  }
}
