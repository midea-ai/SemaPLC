# Model Configuration

## API Key: `.env`

The LLM key is configured in `sema-plc-web/.env` (copied from `.env.example`, gitignored):

```bash
cp .env.example .env
# edit and fill in, e.g.:
# DEEPSEEK_API_KEY=sk-...
```

Select the model at startup with the `PLC_MODEL` environment variable (default `deepseek`):

```bash
PLC_MODEL=minimax-m2.7 ./dev.sh
PLC_MODEL=openai ./dev.sh
```

## Supported Providers

DeepSeek (recommended), MiniMax, Anthropic, Gemini, OpenAI, xAI, Groq, OpenRouter, Qwen (DashScope), Kimi, Z.AI, BigModel, SiliconFlow, Together, Doubao (Volcengine Ark), plus a generic **OpenAI-compatible** slot.

The model registry is implemented in `sema-plc-web/server/model-registry.ts`; keys filled in through the UI are persisted by `server/key-overrides.ts` and merged into `process.env` before the registry is built (values already present in `.env` / the shell take precedence).

## Thinking Mode Switch

`PLC_THINKING` controls the model's thinking (reasoning) mode, enabled by default:

```bash
PLC_THINKING=0 ./dev.sh
```

Disabling it is recommended for DeepSeek — with thinking on, its 8192 output-token cap is easily truncated by `max_tokens`.

## Custom Models: `custom-models.json`

OpenAI/Anthropic-compatible endpoints added through the UI are persisted to `custom-models.json` in the **process working directory** (gitignored). The format is a JSON array:

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

- `id`: of the form `custom:` + a random short id, used as the key for model switching and the registry
- `adapt`: must be `"openai"` or `"anthropic"`, deciding which protocol adapter to use
- Invalid entries are filtered out at load time and do not fail startup

See `sema-plc-web/server/custom-models.ts` for the implementation. If the file does not exist and the legacy `PLC_OPENAI_COMPATIBLE_BASE_URL/MODEL/API_KEY` environment variables are set (`PROVIDER` optional, defaults to `openai` adaptation), they are auto-migrated into the first record.

## Relay/Proxy Compatibility

At backend startup, `relay-fetch-fix` (`server/relay-fetch-fix.ts`) is installed first: for outbound requests to `/chat/completions` and `/messages` endpoints, it strips the OpenAI SDK's `x-stainless-*` fingerprint headers and replaces the UA with a neutral value — otherwise some third-party relays use them to return 403.
