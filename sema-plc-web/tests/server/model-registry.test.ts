import { describe, expect, it, afterEach } from 'vitest'
import { buildModelRegistry, currentModelConfigState, resolveModel, selectModelKey, setRuntimeCustomConfig, writeCustomToEnv } from '../../server/model-registry'

describe('model registry', () => {
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

  it('restores custom Anthropic-compatible config from persisted env', () => {
    const resolved = resolveModel({
      PLC_MODEL: 'custom',
      PLC_OPENAI_COMPATIBLE_API_KEY: 'sk-custom',
      PLC_OPENAI_COMPATIBLE_MODEL: 'vendor-claude',
      PLC_OPENAI_COMPATIBLE_BASE_URL: 'https://vendor.test',
      PLC_OPENAI_COMPATIBLE_PROVIDER: 'anthropic',
    })

    expect(resolved?.id).toBe('vendor-claude[anthropic]')
    expect(resolved?.cfg.adapt).toBe('anthropic')
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

  // 清理运行时 custom 状态,避免测试间泄漏
  afterEach(() => setRuntimeCustomConfig(null))

  it('uses runtime custom config when setRuntimeCustomConfig is called', () => {
    // 未设置时:custom 走 fallback(无 apiKey)→ resolveModel 返回 null(缺 key 分支)
    setRuntimeCustomConfig(null)
    const before = resolveModel({ PLC_MODEL: 'custom' })
    expect(before).toBeNull()

    // 设置后:custom 用运行时配置
    setRuntimeCustomConfig({
      modelName: 'my-custom-model', provider: 'openai',
      baseURL: 'https://my.endpoint/v1', apiKey: 'sk-custom',
      maxTokens: 8000, contextLength: 64000, adapt: 'openai',
    })
    const after = resolveModel({ PLC_MODEL: 'custom' })
    expect(after?.cfg.modelName).toBe('my-custom-model')
    expect(after?.cfg.baseURL).toBe('https://my.endpoint/v1')
    expect(after?.cfg.apiKey).toBe('sk-custom')
    expect(after?.cfg.adapt).toBe('openai')
  })

  it('writeCustomToEnv persists custom selection idempotently without clobbering unrelated keys', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const tmp = path.join(os.tmpdir(), `sema-env-${Date.now()}.env`)
    fs.writeFileSync(tmp, [
      'PLC_MODEL=minimax',
      'PLC_OPENAI_COMPATIBLE_API_KEY=old-key',
      'MINIMAX_API_KEY=keep-me',
      'PLC_OPENAI_COMPATIBLE_BASE_URL=https://old/v1',
      '# comment line',
      '',
    ].join('\n'), 'utf8')

    writeCustomToEnv(tmp, {
      modelName: 'glm-x', provider: 'openai',
      baseURL: 'https://new/v1', apiKey: 'sk-new',
      maxTokens: 32000, contextLength: 128000, adapt: 'openai',
    })

    const out = fs.readFileSync(tmp, 'utf8')
    // 更新了 PLC_MODEL + PLC_OPENAI_COMPATIBLE_* selection/config.
    expect(out).toContain('PLC_MODEL=custom')
    expect(out).toContain('PLC_OPENAI_COMPATIBLE_BASE_URL=https://new/v1')
    expect(out).toContain('PLC_OPENAI_COMPATIBLE_API_KEY=sk-new')
    expect(out).toContain('PLC_OPENAI_COMPATIBLE_MODEL=glm-x')
    expect(out).toContain('PLC_OPENAI_COMPATIBLE_PROVIDER=openai')
    // 保留其它内容
    expect(out).toContain('MINIMAX_API_KEY=keep-me')
    expect(out).toContain('# comment line')
    // 不应有重复行
    expect(out.match(/PLC_MODEL=/g)?.length).toBe(1)
    expect(out.match(/PLC_OPENAI_COMPATIBLE_API_KEY=/g)?.length).toBe(1)
    fs.unlinkSync(tmp)
  })

  it('logs and skips selected providers with missing keys', () => {
    const logs: string[] = []
    const resolved = resolveModel({ PLC_MODEL: 'xai' }, (_level, message) => logs.push(message))

    expect(resolved).toBeNull()
    expect(logs[0]).toContain('LLM key (xai) 未设置')
  })

  it('exposes only verified model options without API keys', () => {
    const state = currentModelConfigState({
      PLC_MODEL: 'gemini',
      GEMINI_API_KEY: 'gemini-secret',
    })

    expect(state.selected).toBe('gemini')
    expect(state.active?.id).toBe('gemini-2.5-flash[openai]')
    expect(state.options.map((o) => o.key)).toEqual([
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
    ])
    expect(state.options.find((o) => o.key === 'gemini')).toMatchObject({ configured: true, status: 'verified' })
    // The custom endpoint has no key in this env, so it surfaces as not configured.
    expect(state.options.find((o) => o.key === 'bigmodel')).toMatchObject({ configured: false })
    expect(state.options.find((o) => o.key === 'openai-compatible')).toMatchObject({ configured: false })
    expect(state.options.find((o) => o.key === 'glm-4.7')).toMatchObject({ configured: false })
    expect(state.options.find((o) => o.key === 'glm-5-turbo')).toMatchObject({ configured: false })
    expect(JSON.stringify(state)).not.toContain('gemini-secret')
  })
})
