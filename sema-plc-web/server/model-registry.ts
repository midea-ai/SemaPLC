import { listCustomModels, type CustomModelEntry } from './custom-models.js'

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
  labelEn: string
  provider: string
  modelName: string
  configured: boolean
  status: 'verified'
  notes?: string
  envHint?: string
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

// 自定义模型 → ModelConfig。自定义列表由 custom-models.ts 持久化(见 buildModelRegistry)。
function customEntryToConfig(e: CustomModelEntry): ModelConfig {
  return {
    modelName: e.modelName,
    provider: e.adapt === 'anthropic' ? 'anthropic' : 'openai',
    baseURL: e.baseURL,
    apiKey: e.apiKey,
    maxTokens: 32000,
    contextLength: 128000,
    adapt: e.adapt,
  }
}

// 从 baseURL 取主机名,用作列表行的副标题(同名模型靠 host 区分)。
function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
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

  const registry: Record<string, ModelConfig> = {
    // DeepSeek 官方两档:Flash / Pro,同一 api.deepseek.com。共享 DEEPSEEK 前缀(同 doubao/qwen 模式)→
    // DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL 两档都生效,只 modelName 缺省值不同。
    deepseek: openAICompatible(env, 'DEEPSEEK', {
      modelName: 'deepseek-v4-flash',
      provider: 'custom',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 8192,
      contextLength: 64000,
    }),
    'deepseek-v4-pro': openAICompatible(env, 'DEEPSEEK', {
      modelName: 'deepseek-v4-pro',
      provider: 'custom',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 8192,
      contextLength: 64000,
    }),
    anthropic: anthropicCompatible(env, 'ANTHROPIC', {
      modelName: 'claude-opus-4-7',
      baseURL: 'https://api.anthropic.com',
      maxTokens: 32000,
      contextLength: 200000,
    }),

    // OpenAI 官方两档:GPT-5.4 / GPT-5.5,同一 api.openai.com。共享 OPENAI 前缀 → OPENAI_API_KEY /
    // OPENAI_BASE_URL 两档都生效,只 modelName 缺省值不同(同 deepseek 上面的模式)。
    openai: openAICompatible(env, 'OPENAI', {
      modelName: 'gpt-5.4',
      baseURL: 'https://api.openai.com/v1',
      maxTokens: 32000,
      contextLength: 400000,
    }),
    'gpt-5.5': openAICompatible(env, 'OPENAI', {
      modelName: 'gpt-5.5',
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
  }
  // UI 自定义模型列表(custom-models.json):每条按其 id 注册为一个可切换通道。
  for (const e of listCustomModels(env)) registry[e.id] = customEntryToConfig(e)
  return registry
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
  'deepseek',
  'deepseek-v4-pro',
  'anthropic',
  'openai',
  'gpt-5.5',
  'xai',
  'minimax',
  'minimax-m2.7',
  'doubao',
  'doubao-turbo',
  'doubao-code',
  'qwen',
  'qwen-plus',
  'qwen-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
  'openrouter',
  'kimi',
  'zai',
  'bigmodel',
  'siliconflow',
] as const

const VERIFIED_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT-5.4',
  'gpt-5.5': 'OpenAI GPT-5.5',
  xai: 'xAI Grok',
  minimax: 'MiniMax M3',
  'minimax-m2.7': 'MiniMax M2.7',
  doubao: '豆包 2.1 Pro',
  'doubao-turbo': '豆包 2.1 Turbo',
  'doubao-code': '豆包 2.0 Code',
  qwen: '通义千问 3.7 Max',
  'qwen-plus': '通义千问 3.7 Plus',
  'qwen-flash': '通义千问 3.5 Flash',
  'gemini-3.5-flash': 'Google Gemini 3.5 Flash',
  'gemini-3.1-pro': 'Google Gemini 3.1 Pro',
  openrouter: 'OpenRouter',
  kimi: 'Kimi K2.6',
  zai: 'zai',
  bigmodel: 'BigModel GLM-5.2',
  siliconflow: 'SiliconFlow GLM-5.2',
}

// English labels for the model picker (UI language = en).
const VERIFIED_LABELS_EN: Record<string, string> = {
  deepseek: 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT-5.4',
  'gpt-5.5': 'OpenAI GPT-5.5',
  xai: 'xAI Grok',
  minimax: 'MiniMax M3',
  'minimax-m2.7': 'MiniMax M2.7',
  doubao: 'Doubao 2.1 Pro',
  'doubao-turbo': 'Doubao 2.1 Turbo',
  'doubao-code': 'Doubao 2.0 Code',
  qwen: 'Qwen 3.7 Max',
  'qwen-plus': 'Qwen 3.7 Plus',
  'qwen-flash': 'Qwen 3.5 Flash',
  'gemini-3.5-flash': 'Google Gemini 3.5 Flash',
  'gemini-3.1-pro': 'Google Gemini 3.1 Pro',
  openrouter: 'OpenRouter',
  kimi: 'Kimi K2.6',
  zai: 'zai',
  bigmodel: 'BigModel GLM-5.2',
  siliconflow: 'SiliconFlow GLM-5.2',
}

const ENV_HINTS: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  'deepseek-v4-pro': 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'gpt-5.5': 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-m2.7': 'MINIMAX_API_KEY',
  doubao: 'DOUBAO_API_KEY',
  'doubao-turbo': 'DOUBAO_API_KEY',
  'doubao-code': 'DOUBAO_API_KEY',
  qwen: 'QWEN_API_KEY',
  'qwen-plus': 'QWEN_API_KEY',
  'qwen-flash': 'QWEN_API_KEY',
  'gemini-3.5-flash': 'GEMINI_API_KEY',
  'gemini-3.1-pro': 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  kimi: 'KIMI_API_KEY',
  zai: 'ZAI_API_KEY',
  bigmodel: 'BIGMODEL_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
}

// 模型选项 key → 其对应的 *_API_KEY 环境变量名(未配置模型 UI 填 key 时用来定位环境变量)。
export function envKeyForModel(key: string): string | undefined {
  return ENV_HINTS[key]
}

export function verifiedModelOptions(env: NodeJS.ProcessEnv = process.env): VerifiedModelOption[] {
  const models = buildModelRegistry(env)
  const verified = VERIFIED_MODEL_KEYS.map((key) => {
    const cfg = models[key]
    const configured = Boolean(cfg.apiKey)
    return {
      key,
      label: VERIFIED_LABELS[key] ?? key,
      labelEn: VERIFIED_LABELS_EN[key] ?? VERIFIED_LABELS[key] ?? key,
      provider: cfg.provider,
      modelName: cfg.modelName,
      configured,
      status: 'verified' as const,
      notes: key === 'gemini-3.5-flash'
        ? 'Passed text stream, tool call, and tool-result roundtrip with gemini-2.5-flash.'
        : key.startsWith('groq')
        ? `Passed Groq tool-call probe with ${cfg.modelName}.`
        : undefined,
      envHint: configured ? undefined : ENV_HINTS[key],
    }
  })
  // 自定义模型列表:标题=模型名,副标题(借用 modelName 字段)=主机名,前端在「自定义」页渲染。
  const custom = listCustomModels(env).map((e) => ({
    key: e.id,
    label: e.modelName,
    labelEn: e.modelName,
    provider: e.adapt === 'anthropic' ? 'anthropic' : 'openai',
    modelName: hostOf(e.baseURL),
    configured: true,
    status: 'verified' as const,
    notes: undefined,
  }))
  return [...verified, ...custom]
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
  // 旧 .env 里 PLC_MODEL=custom(单槽时代)→ 映射到列表第一条,避免解析失败。
  if (env.PLC_MODEL === 'custom') return listCustomModels(env)[0]?.id
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
