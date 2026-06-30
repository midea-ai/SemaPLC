# Model Provider Compatibility Matrix

Use this file to track real provider testing. A provider is **verified** only after it passes text streaming, tool-call parsing, tool-result roundtrip, and one SemaPLC smoke task with a live API key.

Legend:

- `todo` = not tested with a live key yet
- `pass` = passed
- `fail` = failed
- `partial` = usable with caveats
- `n/a` = not applicable

Suggested smoke task:

```text
写一个 1Hz 心跳:让 %QX0.0 每 500ms 翻转一次,用 TON 定时器实现。
```

| Provider | `PLC_MODEL` | Key env | Free/low-cost test path | Suggested first model | Preset | Text stream | Tool call | Tool result roundtrip | SemaPLC smoke | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | paid / existing key | `deepseek-chat` | pass | todo | todo | todo | todo | preset | Existing primary path; OpenAI-compatible plus `reasoning_content`. |
| MiniMax | `minimax` / `minimax-m3` | `MINIMAX_API_KEY` | platform credits if available | `MiniMax-M3` | pass | todo | todo | todo | todo | preset | Existing Anthropic-compatible path. |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | paid / credits if available | `claude-opus-4-7` | pass | todo | todo | todo | todo | preset | Native Anthropic adapter path. |
| Gemini | `gemini` | `GEMINI_API_KEY` | free tier in Google AI Studio | `gemini-2.5-flash` | pass | pass | pass | pass | partial | tool-loop-ok | Text/tool/tool-result probe passed. SemaPLC smoke began writing files, then hit free-tier rate limit. Prefer 2.5 series first; 3.x tool loop is experimental. |
| OpenAI | `openai` | `OPENAI_API_KEY` | paid / credits if available | `gpt-5.4` | pass | todo | todo | todo | todo | preset | OpenAI-compatible baseline. |
| xAI | `xai` | `XAI_API_KEY` | paid | `grok-4.3` | pass | todo | todo | todo | todo | preset | OpenAI-compatible candidate. |
| Groq | `groq` / `groq-gpt-oss-120b` | `GROQ_API_KEY` | free API key / rate-limited | `openai/gpt-oss-120b` | pass | pass | pass | pass | partial | tool-loop-ok | Text/tool/tool-result probe passed. SemaPLC smoke is blocked on free-tier TPM: requested ~15.5k tokens, limit is 8k TPM. |
| Groq | `groq-gpt-oss-20b` | `GROQ_API_KEY` | free API key / rate-limited | `openai/gpt-oss-20b` | pass | pass | pass | pass | partial | tool-loop-ok | Tool-call probe passed. SemaPLC smoke is blocked on free-tier TPM: requested ~31.4k tokens, limit is 8k TPM. |
| Groq | `groq-llama-3.3-70b` | `GROQ_API_KEY` | free API key / rate-limited | `llama-3.3-70b-versatile` | pass | todo | pass | todo | todo | tool-call-ok | Tool-call probe passed; text stream and roundtrip not yet separately probed. |
| Groq | `groq-qwen3-32b` | `GROQ_API_KEY` | free API key / rate-limited | `qwen/qwen3-32b` | pass | todo | pass | todo | todo | tool-call-ok | Tool-call probe passed; text stream and roundtrip not yet separately probed. |
| Groq | `groq-qwen3.6-27b` | `GROQ_API_KEY` | free API key / rate-limited | `qwen/qwen3.6-27b` | pass | todo | pass | todo | todo | tool-call-ok | Tool-call probe passed; text stream and roundtrip not yet separately probed. |
| Groq | n/a | `GROQ_API_KEY` | free API key / rate-limited | `llama-3.1-8b-instant` | n/a | todo | fail | n/a | n/a | failed | Tool call validation failed: model emitted `compat_echo {"value":"ping"}` as a tool name, so it is not listed in the menu. |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | free router / `:free` models | `openrouter/free` | pass | todo | todo | todo | todo | preset | Result depends on routed model; choose a model with tool support when possible. |
| Qwen / DashScope | `qwen` / `dashscope` | `QWEN_API_KEY` | new-user free quota | `qwen-plus` | pass | todo | todo | todo | todo | preset | OpenAI-compatible endpoint. |
| Kimi / Moonshot | `kimi` / `moonshot` | `KIMI_API_KEY` | low-cost top-up / credits | `kimi-k2.6` | pass | todo | todo | todo | todo | preset | OpenAI-compatible endpoint. |
| Z.AI / Zhipu | `zai` / `zhipu` | `ZAI_API_KEY` | credits if available | `glm-4.7` | pass | todo | todo | todo | todo | preset | OpenAI-compatible endpoint. |
| SiliconFlow | `siliconflow` | `SILICONFLOW_API_KEY` | small free credits | `Pro/zai-org/GLM-4.7` | pass | todo | todo | todo | todo | preset | OpenAI-compatible endpoint. |
| Together AI | `together` | `TOGETHER_API_KEY` | credits if available | `MiniMaxAI/MiniMax-M3` | pass | todo | todo | todo | todo | preset | OpenAI-compatible endpoint. |
| Ollama | `ollama` | optional `OLLAMA_API_KEY` | local | `qwen2.5-coder:32b` | pass | todo | todo | todo | todo | preset | Local OpenAI-compatible endpoint; model must support tools. |
| Custom OpenAI-compatible | `openai-compatible` / `custom` | `PLC_OPENAI_COMPATIBLE_API_KEY` | provider-specific | set `PLC_OPENAI_COMPATIBLE_MODEL` | pass | todo | todo | todo | todo | preset | Requires `PLC_OPENAI_COMPATIBLE_BASE_URL`. |

## Test Result Template

When a provider is tested, update the row and optionally add a short note here:

```text
Provider:
Date:
Model:
Base URL:
Text stream:
Tool call:
Tool result roundtrip:
SemaPLC smoke:
Notes:
```
