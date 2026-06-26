#!/usr/bin/env bash
# End-to-end integration test for the recorder plugin + plc_record tool chain.
#
# Verifies (against the real openplc-plc-dev container):
#   ① Pulse waveform closed loop: buildAndRun → forceVariables{pulseScans} →
#      plc_record sees the exact rising+falling edge and the R_TRIG counter +1.
#   ② Upload survival regression (blocker②): a second buildAndRun must NOT
#      disable the recorder plugin in plugins.conf, and 0x46 must stay alive.
#   ③ Decode parity: TIME (TON .et) decoded by plc_record matches
#      plc_readVariables within tolerance. If t.et ever lands in
#      skippedUnrecordable, the script falls back to an INT scan counter
#      (scan_cnt) for the parity check instead.
#
# Idempotent: each run uploads fresh programs; safe to re-run.
# Leaves the PLC RUNNING at the end (container is the user's dev environment).
set -euo pipefail

if ! docker exec openplc-plc-dev true 2>/dev/null; then
  echo "SKIP: openplc-plc-dev container not running"
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS_DIR="$REPO_ROOT"
export TOOLS_DIR

if [ ! -f "$TOOLS_DIR/dist/tools/record.js" ]; then
  echo "FAIL: $TOOLS_DIR/dist not built (run npm run build)"
  exit 1
fi

cd "$TOOLS_DIR"

echo "=== ① Pulse waveform closed loop (R_TRIG edge via plc_record) ==="
node --input-type=module - <<'EOF'
const T = process.env.TOOLS_DIR
const { loadConfig } = await import(`${T}/dist/config.js`)
const { RuntimeClient } = await import(`${T}/dist/client/runtime.js`)
const { handleCompile } = await import(`${T}/dist/tools/compile.js`)
const { handleUpload } = await import(`${T}/dist/tools/upload.js`)
const { handleStart } = await import(`${T}/dist/tools/start.js`)
const { handleBuildAndRun } = await import(`${T}/dist/tools/buildAndRun.js`)
const { handleForceVariables } = await import(`${T}/dist/tools/forceVariables.js`)
const { handleRecord } = await import(`${T}/dist/tools/record.js`)

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1) }
const pass = (msg) => console.log(`PASS: ${msg}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const stCode = `PROGRAM rec_itest_a
  VAR
    sensor AT %IX0.0 : BOOL;
    cnt AT %QW0 : INT;
  END_VAR
  VAR
    rt : R_TRIG;
  END_VAR
  rt(CLK := sensor);
  IF rt.Q THEN
    cnt := cnt + 1;
  END_IF;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : rec_itest_a;
  END_RESOURCE
END_CONFIGURATION
`

const cfg = loadConfig()
const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
const br = await handleBuildAndRun({ stCode }, {
  compile: (i) => handleCompile(i, cfg),
  upload: () => handleUpload({}, cfg),
  start: () => handleStart(client),
})
if (!br.success) fail(`buildAndRun rec_itest_a: ${br.agentSummary}`)
pass('buildAndRun rec_itest_a → RUNNING')

await sleep(3000)

const f = await handleForceVariables({ set: { sensor: true }, pulseScans: 2 }, cfg)
if (!f.success || !f.pulse) fail(`forceVariables pulseScans=2: ${f.errorMessage ?? JSON.stringify(f)}`)
if (f.pulse.startTick == null) fail('pulse.startTick is null')
if (!f.pulse.verified) fail(`pulse not tick-verified: ${JSON.stringify(f.pulse)}`)
pass(`pulse fired: startTick=${f.pulse.startTick} releaseTick=${f.pulse.releaseTick} scansHeld=${f.pulse.scansHeld}`)

await sleep(500) // let post-release frames land in the ring

const rec = await handleRecord({ varNames: ['sensor', 'cnt'], fromTick: f.pulse.startTick - 5 }, cfg)
if (!rec.success) fail(`plc_record: ${rec.errorMessage}`)
if (rec.unresolvedNames.length > 0) fail(`unresolved: ${rec.unresolvedNames.join(',')}`)
if (rec.skippedUnrecordable.length > 0) fail(`skippedUnrecordable: ${rec.skippedUnrecordable.join(',')}`)
if (!rec.programMd5Verified) fail(`programMd5Verified=false (note: ${rec.note ?? '-'})`)
pass(`record window [${rec.window.fromTick}, ${rec.window.toTick}] md5Verified=true`)

const sensor = rec.series.find(s => s.name === 'sensor')
const cnt = rec.series.find(s => s.name === 'cnt')
if (!sensor || !cnt) fail(`missing series: got ${rec.series.map(s => s.name).join(',')}`)

// sensor: exactly one false→true and one true→false transition, in that order
if (sensor.first !== false) fail(`sensor.first=${sensor.first}, expected false (window starts 5 scans before pulse)`)
const rises = sensor.transitions.filter(([, v]) => v === true)
const falls = sensor.transitions.filter(([, v]) => v === false)
if (rises.length !== 1 || falls.length !== 1)
  fail(`sensor edges: ${rises.length} rising / ${falls.length} falling (expected 1/1); transitions=${JSON.stringify(sensor.transitions)}`)
if (rises[0][0] >= falls[0][0]) fail(`rising tick ${rises[0][0]} not before falling tick ${falls[0][0]}`)
pass(`sensor waveform: false → true@${rises[0][0]} → false@${falls[0][0]} (pulse width ${falls[0][0] - rises[0][0]} scans)`)

// cnt: exactly one transition, +1
if (cnt.transitions.length !== 1)
  fail(`cnt transitions=${JSON.stringify(cnt.transitions)} (expected exactly 1)`)
if (cnt.transitions[0][1] !== Number(cnt.first) + 1)
  fail(`cnt ${cnt.first} → ${cnt.transitions[0][1]}, expected +1`)
pass(`cnt incremented exactly once: ${cnt.first} → ${cnt.transitions[0][1]} @tick ${cnt.transitions[0][0]}`)
EOF

echo ""
echo "=== ② Upload survival regression + ③ TIME decode parity ==="
node --input-type=module - <<'EOF'
const T = process.env.TOOLS_DIR
const { loadConfig } = await import(`${T}/dist/config.js`)
const { RuntimeClient } = await import(`${T}/dist/client/runtime.js`)
const { handleCompile } = await import(`${T}/dist/tools/compile.js`)
const { handleUpload } = await import(`${T}/dist/tools/upload.js`)
const { handleStart } = await import(`${T}/dist/tools/start.js`)
const { handleBuildAndRun } = await import(`${T}/dist/tools/buildAndRun.js`)
const { handleRecord } = await import(`${T}/dist/tools/record.js`)
const { handleReadVariables } = await import(`${T}/dist/tools/readVariables.js`)

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1) }
const pass = (msg) => console.log(`PASS: ${msg}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// series.summary only exists when truncated — derive last/monotonic from transitions
const seriesLast = (s) => s.transitions.length ? s.transitions[s.transitions.length - 1][1] : s.first
const seriesMonotonic = (s) => {
  const vals = [s.first, ...s.transitions.map(([, v]) => v)].map(Number)
  return vals.every((v, i) => i === 0 || v >= vals[i - 1])
}

// TON with PT=1h: t.et grows monotonically for the whole test. scan_cnt is the
// INT fallback parity variable in case t.et is ever unrecordable.
const stCode = `PROGRAM rec_itest_b
  VAR
    run_lamp AT %QX0.0 : BOOL;
    scan_cnt AT %QW0 : INT;
  END_VAR
  VAR
    t : TON;
  END_VAR
  t(IN := TRUE, PT := T#1h);
  run_lamp := t.Q;
  scan_cnt := scan_cnt + 1;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : rec_itest_b;
  END_RESOURCE
END_CONFIGURATION
`

const cfg = loadConfig()
const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
const br = await handleBuildAndRun({ stCode }, {
  compile: (i) => handleCompile(i, cfg),
  upload: () => handleUpload({}, cfg),
  start: () => handleStart(client),
})
if (!br.success) fail(`buildAndRun rec_itest_b: ${br.agentSummary}`)
pass('buildAndRun rec_itest_b (second upload) → RUNNING')

await sleep(2000) // let the TON accumulate and the ring fill

// ② part 2: 0x46 INFO still alive — one small record window must succeed
const probe = await handleRecord({ varNames: ['scan_cnt'], lastScans: 10 }, cfg)
if (!probe.success) fail(`0x46 probe after re-upload: ${probe.errorMessage}`)
if (probe.window == null) fail('0x46 probe returned no window')
pass(`0x46 alive after re-upload: window [${probe.window.fromTick}, ${probe.window.toTick}]`)

// ③ decode parity: record first, then live read — t.et keeps growing, so
// read value must be >= record's last value, within a loose 1000ms (anti-flake).
const rec = await handleRecord({ varNames: ['t.et'], lastScans: 5 }, cfg)
if (!rec.success) fail(`record t.et: ${rec.errorMessage}`)

if (rec.skippedUnrecordable.includes('t.et')) {
  // Fallback path (documented in plan): TIME unrecordable → parity on INT scan_cnt.
  console.log('NOTE: t.et in skippedUnrecordable — falling back to INT scan_cnt parity')
  const ri = await handleRecord({ varNames: ['scan_cnt'], lastScans: 5 }, cfg)
  if (!ri.success) fail(`record scan_cnt: ${ri.errorMessage}`)
  const s = ri.series.find(x => x.name === 'scan_cnt')
  if (!s) fail('scan_cnt series missing')
  const rd = await handleReadVariables({ varNames: ['scan_cnt'] }, cfg)
  if (!rd.success) fail(`readVariables scan_cnt: ${rd.errorMessage}`)
  const live = Number(rd.variables['scan_cnt'].value)
  const last = Number(seriesLast(s))
  const diff = live - last
  if (diff < 0 || diff > 200) fail(`scan_cnt parity: record last=${last} read=${live} diff=${diff} scans (expected 0..200)`)
  pass(`INT parity: record last=${last} read=${live} (+${diff} scans between calls)`)
} else {
  const s = rec.series.find(x => x.name === 't.et')
  if (!s) fail(`t.et series missing: ${rec.series.map(x => x.name).join(',')} unresolved=${rec.unresolvedNames.join(',')}`)
  if (!seriesMonotonic(s)) fail(`t.et not monotonic in record window: ${JSON.stringify(s)}`)
  const recLast = Number(seriesLast(s))
  const rd = await handleReadVariables({ varNames: ['t.et'] }, cfg)
  if (!rd.success) fail(`readVariables t.et: ${rd.errorMessage}`)
  const live = Number(rd.variables['t.et'].value)
  if (!(recLast > 0) || !(live > 0)) fail(`t.et not running: record last=${recLast}ms read=${live}ms`)
  const diff = live - recLast
  // et keeps rising between the two calls; same decode (TIMESPEC→ms) on both paths
  if (diff < 0 || diff >= 1000) fail(`TIME parity: record last=${recLast}ms read=${live}ms diff=${diff}ms (expected 0..1000)`)
  pass(`TIME parity: record t.et last=${recLast}ms, readVariables t.et=${live}ms (diff ${diff}ms < 1000ms)`)
}
EOF

echo ""
echo "=== ② plugins.conf: recorder must still be enabled after re-upload ==="
RECORDER_LINE="$(docker exec openplc-plc-dev grep '^recorder,' /workdir/plugins.conf || true)"
if [ -z "$RECORDER_LINE" ]; then
  echo "FAIL: recorder line missing from /workdir/plugins.conf"
  exit 1
fi
ENABLED="$(echo "$RECORDER_LINE" | cut -d',' -f3)"
if [ "$ENABLED" != "1" ]; then
  echo "FAIL: recorder enabled column = '$ENABLED' (expected 1) — upload disabled the plugin"
  echo "      line: $RECORDER_LINE"
  exit 1
fi
echo "PASS: recorder still enabled in plugins.conf: $RECORDER_LINE"

echo ""
echo "ALL INTEGRATION CHECKS PASSED (PLC left RUNNING with rec_itest_b)"
