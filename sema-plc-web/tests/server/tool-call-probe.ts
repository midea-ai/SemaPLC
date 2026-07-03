/**
 * Tool-calling probe: one request per configured provider to verify tool_use response.
 *
 * Usage (from sema-plc-web/):
 *   npx tsx tests/server/tool-call-probe.ts          # uses .env
 *   DEEPSEEK_API_KEY=sk-... npx tsx tests/server/tool-call-probe.ts  # selective
 *
 * Ponytail: one-shot script, no framework, no fixtures.
 */

import { buildModelRegistry } from '../../server/model-registry.js'

const TOOL_DEF_OPENAI = {
  type: 'function' as const,
  function: {
    name: 'get_status',
    description: 'Get current PLC status',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

const TOOL_DEF_ANTHROPIC = {
  name: 'get_status',
  description: 'Get current PLC status',
  input_schema: { type: 'object', properties: {} },
}

async function probeOpenAI(cfg: { modelName: string; baseURL: string; apiKey: string }, timeout = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.modelName,
        messages: [{ role: 'user', content: 'What is the PLC status?' }],
        tools: [TOOL_DEF_OPENAI],
        max_tokens: 200,
      }),
      signal: controller.signal,
    })
    const json: any = await res.json()

    if (!res.ok) return `HTTP ${res.status}: ${json.error?.message ?? JSON.stringify(json.error)}`

    const toolCalls = json.choices?.[0]?.message?.tool_calls
    if (!toolCalls?.length) {
      // Some models reply with text instead of calling the tool — that's a soft fail
      return `no tool_calls in response (model answered with text)`
    }
    return null
  } catch (e: any) {
    return e.name === 'AbortError' ? 'timeout (15s)' : e.message
  } finally {
    clearTimeout(timer)
  }
}

async function probeAnthropic(cfg: { modelName: string; baseURL: string; apiKey: string }, timeout = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(`${cfg.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.modelName,
        max_tokens: 200,
        messages: [{ role: 'user', content: 'What is the PLC status?' }],
        tools: [TOOL_DEF_ANTHROPIC],
      }),
      signal: controller.signal,
    })
    const json: any = await res.json()

    if (!res.ok) return `HTTP ${res.status}: ${json.error?.message ?? JSON.stringify(json.error)}`

    const toolUse = json.content?.some((b: any) => b.type === 'tool_use')
    if (!toolUse) return `no tool_use in response (model answered with text)`

    return null
  } catch (e: any) {
    return e.name === 'AbortError' ? 'timeout (15s)' : e.message
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const models = buildModelRegistry(process.env)

  // Deduplicate: only test one entry per unique (baseURL, modelName) pair.
  // openai-compatible/custom are aliases for the same config — dedup collapses them.
  const seen = new Set<string>()
  const candidates: { key: string; cfg: typeof models[string] }[] = []
  for (const [key, cfg] of Object.entries(models)) {
    if (!cfg.apiKey) continue
    if (!cfg.modelName || !cfg.baseURL) continue
    const sig = `${cfg.baseURL}|${cfg.modelName}|${cfg.adapt}`
    if (seen.has(sig)) continue
    seen.add(sig)
    candidates.push({ key, cfg })
  }

  if (!candidates.length) {
    console.log('No API keys configured. Set *_API_KEY env vars and re-run.')
    process.exit(1)
  }

  console.log(`Probing ${candidates.length} provider(s)…\n`)

  const results: { key: string; model: string; adapt: string; ok: boolean; err: string | null }[] = []

  // Run sequentially to avoid rate limits
  for (const { key, cfg } of candidates) {
    process.stdout.write(`  ${key.padEnd(22)} ${cfg.modelName.padEnd(30)}`)
    const err = cfg.adapt === 'anthropic'
      ? await probeAnthropic(cfg)
      : await probeOpenAI(cfg)
    results.push({ key, model: cfg.modelName, adapt: cfg.adapt, ok: !err, err })
    console.log(err ? ` ✗  ${err}` : ' ✓')
  }

  console.log()
  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`Result: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\nFailed:')
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  ${r.key.padEnd(22)} → ${r.err}`)
    }
  }
}

main()
