# 模型系统

后端的 LLM 接入由四个模块组成:`server/model-registry.ts`(注册表与选择逻辑)、`server/custom-models.ts`(UI 自定义模型的持久化)、`server/key-overrides.ts`(UI 补填 API key 的持久化)、`server/relay-fetch-fix.ts`(出站请求指纹修正)。面向用户的配置说明见 [模型配置](wiki/getting-started/model-config);本页讲实现。

## 注册表结构(model-registry)

`buildModelRegistry(env)` 每次调用都从环境变量现算一张 `Record<string, ModelConfig>`:

```ts
export type ModelConfig = {
  modelName: string
  provider: string      // 传给 sema-core 的适配器提示
  baseURL: string
  apiKey?: string
  maxTokens: number
  contextLength: number
  adapt: string         // 'openai' | 'anthropic'
}
```

每个条目由 `openAICompatible(env, prefix, defaults)` 或 `anthropicCompatible(...)` 工厂生成:环境变量 `<PREFIX>_MODEL` / `<PREFIX>_BASE_URL` / `<PREFIX>_API_KEY` / `<PREFIX>_MAX_TOKENS` / `<PREFIX>_CONTEXT_LENGTH` 覆盖内置默认值。同一厂商的多档模型**共享前缀**(如 `deepseek` 与 `deepseek-v4-pro` 都读 `DEEPSEEK_*`,只有 `modelName` 缺省值不同),所以一个 key 就点亮该厂商全部档位。

两个值得注意的实现细节(均有源码注释背书):

- **豆包的 `provider: 'glm'` 不是笔误**(`model-registry.ts:151`):sema-core 的 openai 适配器只对 `provider === 'glm'` 跳过「自动拼 `/v1`」,否则火山方舟的 `/api/v3` 会被拼成 `/api/v3/v1`。这是当前依赖里唯一的 URL 规整开关,`bigmodel` 同理
- 注册表末尾把 `custom-models.json` 的每条自定义模型按其 `id` 追加为可切换通道

## VERIFIED_MODEL_KEYS 与选项列表

注册表里的 key 远多于 UI 显示的。`VERIFIED_MODEL_KEYS`(`model-registry.ts:321`)是白名单:只有实测通过文本流 / 工具调用 / 工具结果回传的 key 才进模型选择器,当前含 deepseek 两档、anthropic、openai 两档、xai、minimax 两档、doubao 三档、qwen 三档、gemini 两档、openrouter、kimi、zai、bigmodel、siliconflow。每个 key 配中英文标签(`VERIFIED_LABELS` / `VERIFIED_LABELS_EN`)与 `ENV_HINTS`(key → `*_API_KEY` 环境变量名,未配置时 UI 显示提示、填 key 时用来定位落盘变量)。

`verifiedModelOptions()` 生成前端下拉列表:`configured = Boolean(cfg.apiKey)`;自定义模型追加在后,标题用模型名、副标题借用 `modelName` 字段放 baseURL 主机名。`internal:model-switch` 时 bridge 会校验目标 key 必须在 `VERIFIED_MODEL_KEYS` 或自定义列表里,否则拒绝。

## PLC_MODEL / PLC_THINKING

**模型选择**是三级优先(`selectModelKey`,`model-registry.ts:468`):

1. `runtimeModelKey` —— 进程内存里的运行时覆盖,UI 切换模型时经 `setRuntimeModelKey()` 写入,**重启即失效、回到 env 默认**
2. `env.PLC_MODEL` —— `.env` 指定的启动默认;历史值 `custom`(单槽时代)映射到自定义列表第一条
3. `FALLBACK_MODEL_ORDER` —— 都没有时按固定顺序找第一个配了 apiKey 的模型

`resolveModel()` 在此之上做校验:缺 `modelName`/`baseURL`/`apiKey`、或 apiKey 含非 ASCII 字符(典型是没替换的中文占位符)都返回 `null` 并发出可读的错误日志——**模型注册被跳过但服务照常起**,UI / 运行 / 各 tab 不受影响,只有对话不可用。

**PLC_THINKING** 用同样的「运行时覆盖 + env 默认」模式:`getRuntimeThinking()` 返回 `runtimeThinking ?? (env.PLC_THINKING !== '0')`(默认开)。SemaCore 构造期读取一次;UI 的思考开关走 `model:set-thinking` → bridge 调 `core.updateCoreConfig({ thinking })`,**运行时无损切换**,不重建 core、不丢对话。思考会消耗输出 token 预算——撞 `maxTokens` 触发截断时可关闭对比。

## custom-models.json:加载 / 校验 / 迁移

`custom-models.ts` 把 UI 添加的自定义模型持久化到**仓库根**的 `custom-models.json`(与 `.env` 并列,已在 `.gitignore`——**含真实 key,严禁提交**)。格式:

```json
[
  {
    "id": "custom:a1b2c3",
    "baseURL": "https://api.example.com/v1",
    "modelName": "some-model",
    "apiKey": "sk-xxxxxxxx-placeholder",
    "adapt": "openai"
  }
]
```

- **id**:`custom:` + 6 位随机串,生成时查重;作为注册表 key 与 `model:switch` 的目标,删除/切换都按 id
- **校验**:加载时逐条过 `isEntry()` 结构检查(五个字段类型 + `adapt ∈ {openai, anthropic}`),不合格的条目直接过滤掉;整文件 JSON 解析失败按空列表处理
- **迁移**:文件不存在时,若 `.env` 里有完整的旧单槽配置 `PLC_OPENAI_COMPATIBLE_BASE_URL/MODEL/API_KEY`,自动转成列表第一条并落盘——老配置不丢
- 进程内有 `cache`,增删经 `addCustomModel` / `deleteCustomModel` 同步写回文件

转成 `ModelConfig` 时(`customEntryToConfig`)`maxTokens`/`contextLength` 固定 32000/128000,`provider` 由 `adapt` 推出。UI 流程(`internal:custom-add`):追加 → 立即切换过去,`applyModel` 失败则回滚到之前选中的模型;删除当前选中项时回退到第一个已配置的内置模型。

## key-overrides:持久化与 merge 优先级

用户在 UI 给「未配置」的内置模型补填的 API key 存到仓库根 `key-overrides.json`(同样 `.gitignore`),内容是 envKey → 值的映射,如 `{ "DEEPSEEK_API_KEY": "sk-placeholder" }`。

两个入口:

- **启动时** `applyKeyOverrides()`(在 `index.ts` 里、SemaBridge 构建注册表**之前**调用):把映射 merge 进 `process.env`,**但 `.env`/shell 已设的同名变量优先、不覆盖**——`.env` 始终是权威来源,UI 填的只补缺
- **运行时** `saveKeyOverride(envKey, value)`:落盘 + 立即写 `process.env`,后续 `buildModelRegistry` 马上读到

填 key 的完整流程在 bridge 的 `internal:set-key` 分支(`handleInternal()`):先用 `core.testApiConnection()` 对该模型的 baseURL/modelName/adapt + 新 key 发一个短探针请求,**通了才落盘**;失败时把原因和可复制的 curl 调试命令经 `model:key-result` 回给弹窗。`force=true` 跳过探针直接保存——探针的 URL 规整与运行时并不完全一致,可能误报失败,给用户「仍然保存」的越过口子。若刚填 key 的模型正是当前会被选中的那个,顺带 `applyModel` 真正激活(否则 UI 显示已激活但 SemaCore 没注册过任何模型)。

## relay-fetch-fix:抹指纹头

`relay-fetch-fix.ts` 必须是 `index.ts` **最先执行**的 import。原因:sema-core 的 openai 适配器走官方 OpenAI SDK,SDK 默认带 `User-Agent: OpenAI/JS x.x` 和一组 `x-stainless-*` header;部分第三方中转站的风控据此识别为官方 SDK 直连,直接 403(项目里表现为「API权限不足 [PERMISSION_DENIED]」),而 curl / 裸 fetch 请求同一站点正常。

实现是全局 fetch 拦截器:仅当 URL 匹配 `/chat/completions` 或 `/messages`(LLM 端点特征,避免误伤本地 127.0.0.1 请求)时,删除 `SDK_FINGERPRINT_HEADERS` 列出的 7 个 `x-stainless-*` 头并把 `User-Agent` 换成 `curl/8.0`;改写过程任何异常都回退为原样发出,绝不因拦截器抛错。不改 `node_modules`,重装依赖不丢。
