import * as fs from 'fs'

export type ModelConfig = {
  modelName: string
  provider: string
  baseURL: string
  apiKey?: string
  maxTokens: number
  contextLength: number
  adapt: string
}

export type VerifiedModelOption = {
  key: string
  label: string
  provider: string
  modelName: string
  configured: boolean
  status: 'verified'
  notes?: string
}

export type ModelConfigState = {
  selected: string | null
  active: { key: string; id: string; provider: string; modelName: string } | null
  options: VerifiedModelOption[]
}

type ModelDefaults = {
  modelName: string
  baseURL: string
  maxTokens: number
  contextLength: number
  provider?: string
  adapt?: string
  apiKey?: string
}

type LogFn = (level: 'error' | 'info', message: string) => void

let runtimeModelKey: string | null = null

export function getRuntimeModelKey(): string | null {
  return runtimeModelKey
}

export function setRuntimeModelKey(key: string | null): void {
  runtimeModelKey = key
}

// 运行时自定义通道配置(UI 提交)。设置后,'custom' 通道用这份配置而非 .env 里的
// PLC_OPENAI_COMPATIBLE_*。仅存内存,但 writeCustomToEnv 会同步写回 .env 持久化。
let runtimeCustomConfig: ModelConfig | null = null

export function getRuntimeCustomConfig(): ModelConfig | null {
  return runtimeCustomConfig
}

export function setRuntimeCustomConfig(cfg: ModelConfig | null): void {
  runtimeCustomConfig = cfg
}

// 把自定义配置写回 .env(用 PLC_OPENAI_COMPATIBLE_* 变量名,重启后自动加载)。
// 幂等:已存在的行替换,不存在的追加,保留文件其它内容。.env 已在 .gitignore。
export function writeCustomToEnv(envPath: string, cfg: ModelConfig): void {
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : []
  const kv: Record<string, string> = {
    PLC_MODEL: 'custom',
    PLC_OPENAI_COMPATIBLE_BASE_URL: cfg.baseURL,
    PLC_OPENAI_COMPATIBLE_MODEL: cfg.modelName,
    PLC_OPENAI_COMPATIBLE_API_KEY: cfg.apiKey ?? '',
    PLC_OPENAI_COMPATIBLE_PROVIDER: cfg.adapt === 'anthropic' ? 'anthropic' : 'openai',
  }
  const written = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/)
    if (m && kv[m[1]] !== undefined) {
      out.push(`${m[1]}=${kv[m[1]]}`)
      written.add(m[1])
    } else {
      out.push(line)
    }
  }
  for (const [k, v] of Object.entries(kv)) {
    if (!written.has(k)) out.push(`${k}=${v}`)
  }
  fs.writeFileSync(envPath, out.join('\n'), 'utf8')
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function openAICompatible(env: NodeJS.ProcessEnv, prefix: string, defaults: ModelDefaults): ModelConfig {
  return {
    modelName: env[`${prefix}_MODEL`] ?? defaults.modelName,
    provider: defaults.provider ?? 'openai',
    baseURL: env[`${prefix}_BASE_URL`] ?? defaults.baseURL,
    apiKey: defaults.apiKey ?? env[`${prefix}_API_KEY`],
    maxTokens: intEnv(env, `${prefix}_MAX_TOKENS`, defaults.maxTokens),
    contextLength: intEnv(env, `${prefix}_CONTEXT_LENGTH`, defaults.contextLength),
    adapt: defaults.adapt ?? 'openai',
  }
}

function anthropicCompatible(env: NodeJS.ProcessEnv, prefix: string, defaults: ModelDefaults): ModelConfig {
  return {
    modelName: env[`${prefix}_MODEL`] ?? defaults.modelName,
    provider: defaults.provider ?? 'anthropic',
    baseURL: env[`${prefix}_BASE_URL`] ?? defaults.baseURL,
    apiKey: defaults.apiKey ?? env[`${prefix}_API_KEY`],
    maxTokens: intEnv(env, `${prefix}_MAX_TOKENS`, defaults.maxTokens),
    contextLength: intEnv(env, `${prefix}_CONTEXT_LENGTH`, defaults.contextLength),
    adapt: defaults.adapt ?? 'anthropic',
  }
}

function customOpenAICompatible(env: NodeJS.ProcessEnv, modelName = env.PLC_OPENAI_COMPATIBLE_MODEL ?? ''): ModelConfig {
  const provider = env.PLC_OPENAI_COMPATIBLE_PROVIDER ?? 'openai'
  return {
    modelName,
    provider,
    baseURL: env.PLC_OPENAI_COMPATIBLE_BASE_URL ?? '',
    apiKey: env.PLC_OPENAI_COMPATIBLE_API_KEY,
    maxTokens: intEnv(env, 'PLC_OPENAI_COMPATIBLE_MAX_TOKENS', 32000),
    contextLength: intEnv(env, 'PLC_OPENAI_COMPATIBLE_CONTEXT_LENGTH', 128000),
    adapt: provider === 'anthropic' ? 'anthropic' : 'openai',
  }
}

export function buildModelRegistry(env: NodeJS.ProcessEnv = process.env): Record<string, ModelConfig> {
  const minimax = (modelName: string) => anthropicCompatible(env, 'MINIMAX', {
    modelName,
    baseURL: 'https://api.minimaxi.com/anthropic',
    maxTokens: 32000,
    contextLength: 200000,
  })

  const gemini = (modelName: string) => openAICompatible(env, 'GEMINI', {
    modelName,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxTokens: 32000,
    contextLength: 1000000,
    provider: 'openai',
  })

  const groq = (modelName: string) => openAICompatible(env, 'GROQ', {
    modelName,
    baseURL: 'https://api.groq.com/openai/v1',
    maxTokens: 16000,
    contextLength: 131072,
  })

  // 豆包 / 火山方舟。多个子模型(2.1 Pro / 2.1 Turbo / 2.0 Code)共享 DOUBAO_API_KEY,
  // 只 modelName 不同 → 一个工厂(同 minimax/gemini)。provider 设 'glm' 不是笔误——
  // sema-core 的 openai 适配器只对 provider==='glm' 跳过「自动拼 /v1」, 否则 /api/v3 →
  // /api/v3/v1(见 sema-core openai.js:185)。这是当前依赖里唯一的 URL 规整开关。
  const doubao = (modelName: string) => openAICompatible(env, 'DOUBAO', {
    modelName,
    provider: 'glm',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    maxTokens: 32000,
    contextLength: 128000,
  })

  // 通义千问 / 阿里云 DashScope(百炼)。OpenAI 兼容端点,baseURL 已以 /v1 结尾 →
  // sema-core 不会再拼 /v1, 故 provider 无需特殊处理。多个档位(Max/Plus/Flash)共享
  // 一个 QWEN_API_KEY, 只 modelName 不同 → 一个工厂(同 doubao/gemini)。
  const qwen = (modelName: string) => openAICompatible(env, 'QWEN', {
    modelName,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    maxTokens: 32000,
    contextLength: 131072,
  })

  return {
    deepseek: openAICompatible(env, 'DEEPSEEK', {
      modelName: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      provider: 'custom',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: env.DEEPSEEK_API_KEY,
      maxTokens: 8192,
      contextLength: 64000,
    }),
    'deepseek-v4-pro': openAICompatible(env, 'DEEPSEEK_V4_PRO', {
      modelName: env.DEEPSEEK_V4_PRO_MODEL ?? 'deepseek-v4-pro',
      provider: 'custom',
      baseURL: 'https://aimpapi.midea.com/t-aigc/aimp-deepseek-v4-pro/v1',
      apiKey: env.DEEPSEEK_V4_PRO_API_KEY,
      maxTokens: 8192,
      contextLength: 64000,
    }),
    anthropic: anthropicCompatible(env, 'ANTHROPIC', {
      modelName: 'claude-opus-4-7',
      baseURL: 'https://api.anthropic.com',
      maxTokens: 32000,
      contextLength: 200000,
    }),

    openai: openAICompatible(env, 'OPENAI', {
      modelName: 'gpt-5.4',
      baseURL: 'https://api.openai.com/v1',
      maxTokens: 32000,
      contextLength: 400000,
    }),
    xai: openAICompatible(env, 'XAI', {
      modelName: 'grok-4.3',
      baseURL: 'https://api.x.ai/v1',
      maxTokens: 32000,
      contextLength: 256000,
    }),
    groq: groq('openai/gpt-oss-120b'),
    'groq-gpt-oss-120b': groq('openai/gpt-oss-120b'),
    'groq-gpt-oss-20b': groq('openai/gpt-oss-20b'),
    'groq-llama-3.3-70b': groq('llama-3.3-70b-versatile'),
    'groq-qwen3-32b': groq('qwen/qwen3-32b'),
    'groq-qwen3.6-27b': groq('qwen/qwen3.6-27b'),
    openrouter: openAICompatible(env, 'OPENROUTER', {
      modelName: '~openai/gpt-latest',
      baseURL: 'https://openrouter.ai/api/v1',
      maxTokens: 32000,
      contextLength: 200000,
    }),
    qwen: qwen('qwen3.7-max'),
    'qwen-plus': qwen('qwen3.7-plus'),
    'qwen-flash': qwen('qwen3.5-flash'),
    dashscope: qwen('qwen3.7-max'),
    kimi: openAICompatible(env, 'KIMI', {
      modelName: 'kimi-k2.6',
      baseURL: 'https://api.moonshot.ai/v1',
      maxTokens: 32000,
      contextLength: 256000,
    }),
    moonshot: openAICompatible(env, 'KIMI', {
      modelName: 'kimi-k2.6',
      baseURL: 'https://api.moonshot.ai/v1',
      maxTokens: 32000,
      contextLength: 256000,
    }),
    zai: openAICompatible(env, 'ZAI', {
      modelName: 'glm-5.2',
      baseURL: 'https://api.z.ai/api/paas/v4',
      maxTokens: 32000,
      contextLength: 1000000,
    }),
    zhipu: openAICompatible(env, 'ZAI', {
      modelName: 'glm-5.2',
      baseURL: 'https://api.z.ai/api/paas/v4',
      maxTokens: 32000,
      contextLength: 1000000,
    }),
    bigmodel: openAICompatible(env, 'BIGMODEL', {
      modelName: env.BIGMODEL_MODEL ?? 'glm-5.2',
      provider: 'glm',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      maxTokens: 32000,
      contextLength: 128000,
    }),
    siliconflow: openAICompatible(env, 'SILICONFLOW', {
      modelName: 'Pro/zai-org/GLM-5.2',
      baseURL: 'https://api.siliconflow.cn/v1',
      maxTokens: 32000,
      contextLength: 1000000,
    }),
    doubao: doubao('doubao-seed-2-1-pro-260628'),
    'doubao-turbo': doubao('doubao-seed-2-1-turbo-260628'),
    'doubao-code': doubao('doubao-seed-2-0-code-preview-260215'),

    together: openAICompatible(env, 'TOGETHER', {
      modelName: 'MiniMaxAI/MiniMax-M3',
      baseURL: 'https://api.together.xyz/v1',
      maxTokens: 32000,
      contextLength: 200000,
    }),

    minimax: minimax('MiniMax-M3'),
    'minimax-m3': minimax('MiniMax-M3'),
    'minimax-m2.7': minimax('MiniMax-M2.7'),
    'minimax-m2.7-highspeed': minimax('MiniMax-M2.7-highspeed'),
    'minimax-m2.5': minimax('MiniMax-M2.5'),
    'minimax-m2.5-highspeed': minimax('MiniMax-M2.5-highspeed'),

    gemini: gemini('gemini-2.5-flash'),
    'gemini-2.5-flash': gemini('gemini-2.5-flash'),
    'gemini-2.5-pro': gemini('gemini-2.5-pro'),
    'gemini-3.5-flash': gemini('gemini-3.5-flash'),
    'gemini-3.1': gemini('gemini-3.1-pro-preview'),
    'gemini-3.1-pro': gemini('gemini-3.1-pro-preview'),

    'openai-compatible': customOpenAICompatible(env),
    'glm-4.7': customOpenAICompatible(env, 'glm-4.7'),
    'glm-5-turbo': customOpenAICompatible(env, 'glm-5-turbo'),
    // 'custom' 是 UI 自定义通道的载体:运行时配置优先(由 setRuntimeCustomConfig 设置),
    // 否则 fallback 到 .env 的 PLC_OPENAI_COMPATIBLE_*(重启后从写回的 .env 自动恢复)。
    custom: runtimeCustomConfig ?? customOpenAICompatible(env),
  }
}

export const FALLBACK_MODEL_ORDER = [
  'deepseek',
  'minimax',
  'anthropic',
  'gemini',
  'openai',
  'xai',
  'groq',
  'openrouter',
  'qwen',
  'kimi',
  'bigmodel',
  'zai',
  'siliconflow',
  'together',
]

export const VERIFIED_MODEL_KEYS = [
  'minimax',
  'doubao',
  'doubao-turbo',
  'doubao-code',
  'qwen',
  'qwen-plus',
  'qwen-flash',
  'gemini',
  'groq',
  'groq-gpt-oss-20b',
  'groq-llama-3.3-70b',
  'groq-qwen3-32b',
  'groq-qwen3.6-27b',
  'bigmodel',
  'openai-compatible',
  'glm-4.7',
  'glm-5-turbo',
  'custom',
] as const

const VERIFIED_LABELS: Record<string, string> = {
  minimax: 'MiniMax (Anthropic 兼容)',
  doubao: '豆包 2.1 Pro',
  'doubao-turbo': '豆包 2.1 Turbo',
  'doubao-code': '豆包 2.0 Code',
  qwen: '通义千问 3.7 Max',
  'qwen-plus': '通义千问 3.7 Plus',
  'qwen-flash': '通义千问 3.5 Flash',
  gemini: 'Google Gemini',
  groq: 'Groq GPT OSS 120B',
  'groq-gpt-oss-20b': 'Groq GPT OSS 20B',
  'groq-llama-3.3-70b': 'Groq Llama 3.3 70B',
  'groq-qwen3-32b': 'Groq Qwen3 32B',
  'groq-qwen3.6-27b': 'Groq Qwen3.6 27B',
  bigmodel: 'BigModel GLM-5.2',
  'openai-compatible': 'GLM 中转站 (GLM-5.2)',
  'glm-4.7': 'GLM 中转站 (GLM-4.7)',
  'glm-5-turbo': 'GLM 中转站 (GLM-5-Turbo)',
  custom: '自定义模型',
}

export function verifiedModelOptions(env: NodeJS.ProcessEnv = process.env): VerifiedModelOption[] {
  const models = buildModelRegistry(env)
  return VERIFIED_MODEL_KEYS.map((key) => {
    const cfg = models[key]
    return {
      key,
      label: VERIFIED_LABELS[key] ?? key,
      provider: cfg.provider,
      modelName: cfg.modelName,
      configured: Boolean(cfg.apiKey),
      status: 'verified' as const,
      notes: key === 'gemini'
        ? 'Passed text stream, tool call, and tool-result roundtrip with gemini-2.5-flash.'
        : key.startsWith('groq')
        ? `Passed Groq tool-call probe with ${cfg.modelName}.`
        : undefined,
    }
  })
}

export function currentModelConfigState(env: NodeJS.ProcessEnv = process.env): ModelConfigState {
  const models = buildModelRegistry(env)
  const selected = selectModelKey(env, models) ?? null
  const cfg = selected ? models[selected] : null
  const active = selected && cfg?.apiKey && cfg.modelName && cfg.baseURL && isAsciiApiKey(cfg.apiKey)
    ? { key: selected, id: `${cfg.modelName}[${cfg.provider}]`, provider: cfg.provider, modelName: cfg.modelName }
    : null
  return { selected, active, options: verifiedModelOptions(env) }
}

export function selectModelKey(env: NodeJS.ProcessEnv = process.env, models = buildModelRegistry(env)): string | undefined {
  if (runtimeModelKey) return runtimeModelKey
  if (env.PLC_MODEL) return env.PLC_MODEL
  return FALLBACK_MODEL_ORDER.find((key) => Boolean(models[key]?.apiKey))
}

function isAsciiApiKey(apiKey: string): boolean {
  return /^[\x20-\x7E]+$/.test(apiKey)
}

export function resolveModel(
  env: NodeJS.ProcessEnv = process.env,
  log: LogFn = () => {},
): { cfg: ModelConfig; id: string; selected: string } | null {
  const models = buildModelRegistry(env)
  const selected = selectModelKey(env, models)
  if (!selected) return null

  const cfg = models[selected]
  if (!cfg) throw new Error(`unknown PLC_MODEL='${selected}', options: ${Object.keys(models).join(' | ')}`)

  if (!cfg.modelName || !cfg.baseURL) {
    log('error', `LLM model (${selected}) 缺少 model 或 baseURL——请设置对应的 *_MODEL / *_BASE_URL 后重启。`)
    return null
  }

  if (!cfg.apiKey) {
    log('error', `LLM key (${selected}) 未设置——已跳过模型注册,左侧对话不可用。复制 .env.example 为 .env 填入对应的 *_API_KEY 后重启即可启用;UI / 运行 / 各 tab 不受影响。`)
    return null
  }

  if (!isAsciiApiKey(cfg.apiKey)) {
    log('error', `LLM key (${selected}) 含非 ASCII 字符或仍是占位符——已跳过模型注册,左侧对话不可用。请用真实 *_API_KEY 重启;UI / 运行 / 各 tab 不受影响。`)
    return null
  }

  return { cfg, id: `${cfg.modelName}[${cfg.provider}]`, selected }
}
