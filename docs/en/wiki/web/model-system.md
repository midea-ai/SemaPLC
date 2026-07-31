# Model System

The backend's LLM integration consists of four modules: `server/model-registry.ts` (registry and selection logic), `server/custom-models.ts` (persistence for UI-added custom models), `server/key-overrides.ts` (persistence for API keys filled in via the UI), and `server/relay-fetch-fix.ts` (outbound request fingerprint fixing). For user-facing configuration see [Model Configuration](en/wiki/getting-started/model-config); this page covers the implementation.

## Registry Structure (model-registry)

Every call to `buildModelRegistry(env)` computes a fresh `Record<string, ModelConfig>` from environment variables:

```ts
export type ModelConfig = {
  modelName: string
  provider: string      // adapter hint passed to sema-core
  baseURL: string
  apiKey?: string
  maxTokens: number
  contextLength: number
  adapt: string         // 'openai' | 'anthropic'
}
```

Each entry is produced by the `openAICompatible(env, prefix, defaults)` or `anthropicCompatible(...)` factory: environment variables `<PREFIX>_MODEL` / `<PREFIX>_BASE_URL` / `<PREFIX>_API_KEY` / `<PREFIX>_MAX_TOKENS` / `<PREFIX>_CONTEXT_LENGTH` override the built-in defaults. Multiple tiers of the same vendor **share a prefix** (e.g. both `deepseek` and `deepseek-v4-pro` read `DEEPSEEK_*`, differing only in the default `modelName`), so one key lights up every tier of that vendor.

Two implementation details worth noting (both backed by source comments):

- **Doubao's `provider: 'glm'` is not a typo** (`model-registry.ts:151`): sema-core's openai adapter skips its "auto-append `/v1`" behavior only when `provider === 'glm'`; otherwise Volcengine Ark's `/api/v3` would become `/api/v3/v1`. This is the only URL-normalization switch in the current dependency; `bigmodel` works the same way
- At the end of the registry, each custom model from `custom-models.json` is appended as a switchable channel keyed by its `id`

## VERIFIED_MODEL_KEYS and the Options List

The registry contains far more keys than the UI shows. `VERIFIED_MODEL_KEYS` (`model-registry.ts:321`) is a whitelist: only keys that have passed real-world tests of text streaming / tool calling / tool result round-tripping enter the model picker; it currently contains two deepseek tiers, anthropic, two openai tiers, xai, two minimax tiers, three doubao tiers, three qwen tiers, two gemini tiers, openrouter, kimi, zai, bigmodel, siliconflow. Each key has Chinese and English labels (`VERIFIED_LABELS` / `VERIFIED_LABELS_EN`) and `ENV_HINTS` (key -> `*_API_KEY` environment variable name; the UI shows it as a hint when unconfigured and uses it to locate the persisted variable when a key is entered).

`verifiedModelOptions()` generates the frontend dropdown: `configured = Boolean(cfg.apiKey)`; custom models are appended at the end, with the model name as the title and the `modelName` field repurposed as the subtitle holding the baseURL hostname. On `internal:model-switch` the bridge validates that the target key must be in `VERIFIED_MODEL_KEYS` or the custom list, otherwise it is rejected.

## PLC_MODEL / PLC_THINKING

**Model selection** follows a three-level priority (`selectModelKey`, `model-registry.ts:468`):

1. `runtimeModelKey` -- the runtime override held in process memory, written via `setRuntimeModelKey()` when the UI switches models; **lost on restart, reverting to the env default**
2. `env.PLC_MODEL` -- the startup default specified in `.env`; the legacy value `custom` (from the single-slot era) maps to the first entry of the custom list
3. `FALLBACK_MODEL_ORDER` -- when neither is set, walk a fixed order and take the first model with an apiKey configured

`resolveModel()` validates on top of this: a missing `modelName`/`baseURL`/`apiKey`, or an apiKey containing non-ASCII characters (typically an unreplaced Chinese placeholder), returns `null` with a readable error log -- **model registration is skipped but the service still starts**; the UI / run / all tabs are unaffected, only chat is unavailable.

**PLC_THINKING** uses the same "runtime override + env default" pattern: `getRuntimeThinking()` returns `runtimeThinking ?? (env.PLC_THINKING !== '0')` (on by default). SemaCore reads it once at construction; the UI's thinking toggle goes through `model:set-thinking` -> the bridge calls `core.updateCoreConfig({ thinking })`, a **lossless runtime switch** -- no core rebuild, no conversation loss. Thinking consumes output token budget -- if you hit `maxTokens` truncation, try turning it off for comparison.

## custom-models.json: Loading / Validation / Migration

`custom-models.ts` persists UI-added custom models to `custom-models.json` at the **repo root** (next to `.env`, already in `.gitignore` -- **contains real keys, must never be committed**). Format:

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

- **id**: `custom:` + a 6-character random string, checked for duplicates at generation; serves as the registry key and the target of `model:switch`; deletion/switching both go by id
- **Validation**: on load, each entry passes through the `isEntry()` structural check (types of the five fields + `adapt ∈ {openai, anthropic}`); non-conforming entries are simply filtered out; if the whole file fails JSON parsing, it is treated as an empty list
- **Migration**: if the file does not exist and `.env` holds a complete legacy single-slot configuration `PLC_OPENAI_COMPATIBLE_BASE_URL/MODEL/API_KEY`, it is automatically converted into the list's first entry and written to disk -- old configurations are not lost
- An in-process `cache` exists; additions/deletions go through `addCustomModel` / `deleteCustomModel`, which write back to the file synchronously

When converting to `ModelConfig` (`customEntryToConfig`), `maxTokens`/`contextLength` are fixed at 32000/128000, and `provider` is derived from `adapt`. UI flow (`internal:custom-add`): append -> immediately switch to it; if `applyModel` fails, roll back to the previously selected model; when deleting the currently selected entry, fall back to the first configured built-in model.

## key-overrides: Persistence and Merge Precedence

API keys the user fills in via the UI for "unconfigured" built-in models are stored in `key-overrides.json` at the repo root (also in `.gitignore`); the content is an envKey-to-value mapping, e.g. `{ "DEEPSEEK_API_KEY": "sk-placeholder" }`.

Two entry points:

- **At startup** `applyKeyOverrides()` (called in `index.ts`, **before** SemaBridge builds the registry): merges the mapping into `process.env`, **but variables of the same name already set in `.env`/the shell take precedence and are not overwritten** -- `.env` remains the authoritative source; UI-entered keys only fill gaps
- **At runtime** `saveKeyOverride(envKey, value)`: writes to disk + immediately writes `process.env`, so subsequent `buildModelRegistry` calls pick it up right away

The full key-entry flow lives in the bridge's `internal:set-key` branch (`handleInternal()`): first use `core.testApiConnection()` to send a short probe request against that model's baseURL/modelName/adapt + the new key, and **only persist if it succeeds**; on failure the reason and a copy-pastable curl debug command are returned to the dialog via `model:key-result`. `force=true` skips the probe and saves directly -- the probe's URL normalization is not exactly identical to runtime and may report false failures, so the user gets a "save anyway" escape hatch. If the model whose key was just entered is exactly the one currently selected, `applyModel` is also called to truly activate it (otherwise the UI would show it as active while SemaCore has never registered any model).

## relay-fetch-fix: Stripping Fingerprint Headers

`relay-fetch-fix.ts` must be the **first** import executed in `index.ts`. Reason: sema-core's openai adapter uses the official OpenAI SDK, which by default sends `User-Agent: OpenAI/JS x.x` and a set of `x-stainless-*` headers; the risk-control systems of some third-party relay sites use these to identify direct official-SDK connections and return 403 outright (surfacing in this project as "API权限不足 [PERMISSION_DENIED]"), while curl / bare fetch requests to the same site work fine.

The implementation is a global fetch interceptor: only when the URL matches `/chat/completions` or `/messages` (LLM endpoint signatures, avoiding collateral damage to local 127.0.0.1 requests), it deletes the 7 `x-stainless-*` headers listed in `SDK_FINGERPRINT_HEADERS` and replaces `User-Agent` with `curl/8.0`; any exception during rewriting falls back to sending the request unmodified -- the interceptor never throws. It does not modify `node_modules`, so reinstalling dependencies does not lose the fix.
