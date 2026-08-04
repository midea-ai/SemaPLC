# 模型配置

## API key:`.env`

LLM key 配置在 `sema-plc-web/.env`(从 `.env.example` 复制,已 gitignore):

```bash
cp .env.example .env
# 编辑填入,例如:
# DEEPSEEK_API_KEY=sk-...
```

启动时用 `PLC_MODEL` 环境变量选模型(默认 `deepseek`):

```bash
PLC_MODEL=minimax-m2.7 ./dev.sh
PLC_MODEL=openai ./dev.sh
```

## 支持的提供商

DeepSeek(推荐)、MiniMax、Anthropic、Gemini、OpenAI、xAI、Groq、OpenRouter、Qwen(DashScope)、Kimi、Z.AI、BigModel、SiliconFlow、Together、豆包(火山方舟),以及一个通用的 **OpenAI-compatible** 槽位。

模型注册表实现在 `sema-plc-web/server/model-registry.ts`;UI 里补填的 key 由 `server/key-overrides.ts` 持久化,并在构建注册表前合并进 `process.env`(`.env` / shell 已有的值优先)。

## 思考模式开关

`PLC_THINKING` 控制模型的思考(reasoning)模式,默认开启:

```bash
PLC_THINKING=0 ./dev.sh
```

DeepSeek 建议关闭 —— 其 8192 输出 token 上限在开思考时容易被 `max_tokens` 截断。

## 自定义模型:`custom-models.json`

在 UI 中添加的 OpenAI/Anthropic 兼容端点会持久化到**进程工作目录**下的 `custom-models.json`(已 gitignore)。格式为 JSON 数组:

```json
[
  {
    "id": "custom:a1b2c3",
    "baseURL": "https://your-endpoint.example.com/v1",
    "modelName": "your-model-name",
    "apiKey": "YOUR_API_KEY",
    "adapt": "openai"
  }
]
```

- `id`:形如 `custom:` + 随机短 id,作为模型切换与注册表的 key
- `adapt`:只能是 `"openai"` 或 `"anthropic"`,决定用哪种协议适配
- 非法条目在加载时被过滤,不会导致启动失败

实现见 `sema-plc-web/server/custom-models.ts`。若文件不存在且设置了旧的 `PLC_OPENAI_COMPATIBLE_BASE_URL/MODEL/API_KEY` 三个环境变量(`PROVIDER` 可选,缺省按 `openai` 适配),会自动迁移为第一条记录。

## 中转/代理兼容

后端启动时会先安装 `relay-fetch-fix`(`server/relay-fetch-fix.ts`),对发往 `/chat/completions`、`/messages` 端点的出站请求删掉 OpenAI SDK 的 `x-stainless-*` 指纹头、并把 UA 换成中性值 —— 否则部分第三方中转会据此返回 403。
