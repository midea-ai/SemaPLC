import { describe, expect, it, afterEach } from 'vitest'
import { buildModelRegistry, currentModelConfigState, resolveModel, selectModelKey, setRuntimeModelKey } from '../../server/model-registry'

describe('model registry', () => {
  afterEach(() => setRuntimeModelKey(null))

  it('keeps existing provider aliases and adds OpenAI-compatible providers', () => {
    const models = buildModelRegistry({})

    expect(models.deepseek.modelName).toBe('deepseek-chat')
    expect(models.minimax.modelName).toBe('MiniMax-M3')
    expect(models.gemini.modelName).toBe('gemini-2.5-flash')
    expect(models.qwen.modelName).toBe('qwen3.7-max')

    expect(models.openai.baseURL).toBe('https://api.openai.com/v1')
    expect(models.xai.baseURL).toBe('https://api.x.ai/v1')
    expect(models.groq.baseURL).toBe('https://api.groq.com/openai/v1')
    expect(models.openrouter.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(models.qwen.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(models.kimi.baseURL).toBe('https://api.moonshot.ai/v1')
    expect(models.zai.baseURL).toBe('https://api.z.ai/api/paas/v4')
    expect(models.bigmodel.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(models.siliconflow.baseURL).toBe('https://api.siliconflow.cn/v1')
    expect(models.together.baseURL).toBe('https://api.together.xyz/v1')
  })

  it('lets env override model, base URL, and token budgets', () => {
    const models = buildModelRegistry({
      PLC_MODEL: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-custom',
      OPENAI_BASE_URL: 'https://example.test/v1',
      OPENAI_MAX_TOKENS: '1234',
      OPENAI_CONTEXT_LENGTH: '5678',
    })

    expect(models.openai).toMatchObject({
      modelName: 'gpt-custom',
      baseURL: 'https://example.test/v1',
      maxTokens: 1234,
      contextLength: 5678,
      apiKey: 'sk-test',
    })
  })

  it('preserves fallback priority and then includes new providers', () => {
    expect(selectModelKey({ OPENAI_API_KEY: 'sk-openai' })).toBe('openai')
    expect(selectModelKey({ OPENAI_API_KEY: 'sk-openai', DEEPSEEK_API_KEY: 'sk-deepseek' })).toBe('deepseek')
    expect(selectModelKey({ QWEN_API_KEY: 'sk-qwen' })).toBe('qwen')
  })

  it('resolves explicit OpenAI-compatible custom config', () => {
    const resolved = resolveModel({
      PLC_MODEL: 'openai-compatible',
      PLC_OPENAI_COMPATIBLE_API_KEY: 'sk-custom',
      PLC_OPENAI_COMPATIBLE_MODEL: 'vendor-model',
      PLC_OPENAI_COMPATIBLE_BASE_URL: 'https://vendor.test/v1',
    })

    expect(resolved?.id).toBe('vendor-model[openai]')
    expect(resolved?.cfg.apiKey).toBe('sk-custom')
  })

  it('adds fixed GLM relay model options sharing the OpenAI-compatible endpoint', () => {
    const env = {
      PLC_OPENAI_COMPATIBLE_API_KEY: 'sk-glm-relay',
      PLC_OPENAI_COMPATIBLE_BASE_URL: 'https://ai.tvt.wiki/v1',
    }
    const models = buildModelRegistry(env)

    expect(models['glm-4.7']).toMatchObject({
      modelName: 'glm-4.7',
      baseURL: 'https://ai.tvt.wiki/v1',
      apiKey: 'sk-glm-relay',
      provider: 'openai',
    })
    expect(models['glm-5-turbo']).toMatchObject({
      modelName: 'glm-5-turbo',
      baseURL: 'https://ai.tvt.wiki/v1',
      apiKey: 'sk-glm-relay',
      provider: 'openai',
    })

    expect(resolveModel({ ...env, PLC_MODEL: 'glm-5-turbo' })?.id).toBe('glm-5-turbo[openai]')
  })

  it('resolves BigModel GLM with provider=glm to avoid /v1 mis-append', () => {
    const resolved = resolveModel({
      PLC_MODEL: 'bigmodel',
      BIGMODEL_API_KEY: 'bigmodel-test',
    })

    expect(resolved?.cfg).toMatchObject({
      modelName: 'glm-5.2',
      provider: 'glm',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'bigmodel-test',
    })
    expect(resolved?.id).toBe('glm-5.2[glm]')

    const override = resolveModel({
      PLC_MODEL: 'bigmodel',
      BIGMODEL_API_KEY: 'bigmodel-test',
      BIGMODEL_MODEL: 'glm-5-turbo',
    })
    expect(override?.cfg.modelName).toBe('glm-5-turbo')
  })

  it('resolves doubao (火山方舟) variants with correct baseURL and provider to avoid /v1 mis-append', () => {
    // 默认 2.1 Pro
    const def = resolveModel({
      PLC_MODEL: 'doubao',
      DOUBAO_API_KEY: 'ark-test',
    })
    expect(def?.cfg.modelName).toBe('doubao-seed-2-1-pro-260628')
    expect(def?.cfg.baseURL).toBe('https://ark.cn-beijing.volces.com/api/v3')
    // provider 必须是 'glm' —— sema-core 据此跳过「自动拼 /v1」, 否则 /api/v3 → /api/v3/v1
    expect(def?.cfg.provider).toBe('glm')
    expect(def?.cfg.apiKey).toBe('ark-test')

    // 三个子通道共享 DOUBAO_API_KEY、baseURL、provider, 只 modelName 不同
    const turbo = resolveModel({ PLC_MODEL: 'doubao-turbo', DOUBAO_API_KEY: 'ark-test' })
    expect(turbo?.cfg.modelName).toBe('doubao-seed-2-1-turbo-260628')
    expect(turbo?.cfg.baseURL).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(turbo?.cfg.provider).toBe('glm')
    expect(turbo?.cfg.apiKey).toBe('ark-test')

    const code = resolveModel({ PLC_MODEL: 'doubao-code', DOUBAO_API_KEY: 'ark-test' })
    expect(code?.cfg.modelName).toBe('doubao-seed-2-0-code-preview-260215')
    expect(code?.cfg.provider).toBe('glm')
  })

  it('resolves qwen (DashScope) variants sharing one endpoint', () => {
    // baseURL 以 /v1 结尾 → sema-core 不会再拼 /v1, provider 无需特殊处理
    const mx = resolveModel({ PLC_MODEL: 'qwen', QWEN_API_KEY: 'sk-qwen' })
    expect(mx?.cfg.modelName).toBe('qwen3.7-max')
    expect(mx?.cfg.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(mx?.cfg.apiKey).toBe('sk-qwen')

    const plus = resolveModel({ PLC_MODEL: 'qwen-plus', QWEN_API_KEY: 'sk-qwen' })
    expect(plus?.cfg.modelName).toBe('qwen3.7-plus')

    const flash = resolveModel({ PLC_MODEL: 'qwen-flash', QWEN_API_KEY: 'sk-qwen' })
    expect(flash?.cfg.modelName).toBe('qwen3.5-flash')
  })

  it('logs and skips selected providers with missing keys', () => {
    const logs: string[] = []
    const resolved = resolveModel({ PLC_MODEL: 'xai' }, (_level, message) => logs.push(message))

    expect(resolved).toBeNull()
    expect(logs[0]).toContain('LLM key (xai) 未设置')
  })

  it('exposes only verified model options without API keys', () => {
    const state = currentModelConfigState({
      PLC_MODEL: 'gemini-3.5-flash',
      GEMINI_API_KEY: 'gemini-secret',
    })

    expect(state.selected).toBe('gemini-3.5-flash')
    expect(state.active?.id).toBe('gemini-3.5-flash[openai]')
    // 内置(非 custom)选项恰为 VERIFIED_MODEL_KEYS(顺序一致)。过滤掉 custom:*,
    // 避免依赖 cwd 里可能存在的 custom-models.json。
    expect(state.options.filter((o) => !o.key.startsWith('custom')).map((o) => o.key)).toEqual([
      'deepseek',
      'anthropic',
      'openai',
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
    ])
    // 唯一配了 key 的是 gemini-3.5-flash(共享 GEMINI_API_KEY 的 gemini-3.1-pro 也配上了)。
    expect(state.options.find((o) => o.key === 'gemini-3.5-flash')).toMatchObject({ configured: true, status: 'verified' })
    expect(state.options.find((o) => o.key === 'gemini-3.1-pro')).toMatchObject({ configured: true })
    // 未配 key 的模型:configured=false,且带上要设置的 env 变量名 envHint。
    expect(state.options.find((o) => o.key === 'bigmodel')).toMatchObject({ configured: false, envHint: 'BIGMODEL_API_KEY' })
    expect(state.options.find((o) => o.key === 'deepseek')).toMatchObject({ configured: false, envHint: 'DEEPSEEK_API_KEY' })
    expect(JSON.stringify(state)).not.toContain('gemini-secret')
  })
})
