# 填 key 时校验链路 — 设计

日期:2026-07-01
关联:模型面板「未配置模型填 key」功能(见 `sema-plc-web` 的 `key-overrides.ts` / `TopBar.tsx` 填 key 弹窗)。

## 目标

用户在弹窗里为「未配置」的内置已验证模型填入 API key 并点保存时,后端**先发一次短请求探链路**,通了才把 key 持久化;不通则不保存、原地告诉用户为什么。

## 决策(已敲定)

- **策略 B(软门禁):默认测不过就不保存、原地报错;但给用户「仍然保存(跳过校验)」的越过口子。**
  最初定的是纯策略 A(硬门禁),但 code review 发现探针的 URL 规整
  (`apiUtil.buildApiUrl`,含 `/v\d+` 段就不加 `/v1`)与运行时(`openai.js`,仅
  `endsWith('/v1')` 才不加)**并不一致**,在 baseURL 含 `/vN` 但不以 `/v1` 结尾的模型
  (如 gemini `/v1beta/openai`、zai `/api/paas/v4`)上会拼出不同 URL → 探针可能误报失败。
  硬拦会误伤好 key,故改为软门禁:探针失败时不自动保存,由用户 `force` 越过。
- **只在填 key 保存这一次校验。** 不做周期性 / 重复重测。
- **运行时 key 失效** 沿用现有 `session:error` 提示,**绝不删** 已存的 key。
- **失败信息带上可复制的 curl 调试命令**,方便手动排查是 key 错还是端点抽风。

## 校验探针(现成能力)

SemaCore 实例暴露 `testApiConnection(params: ApiTestParams): Promise<ApiTestResult>`:
- `ApiTestParams = { provider?, baseURL, apiKey, modelName, adapt }`
- 内部对目标端点发一个最小 completion(让模型回 "YES"),响应含 "YES" 即 `success:true`。
- `ApiTestResult = { success: boolean; message: string; curlCommand?: string }`
- **独立于会话模型**,不影响当前正在用的 active 模型。

## 消息契约

新增一条服务端→前端消息(`shared/protocol.ts` 的 `ServerMessage`):

```ts
// client → server
{ type: 'model:set-key'; key: string; apiKey: string; force?: boolean }
// server → client(校验结果)
{ type: 'model:key-result'; key: string; ok: boolean; message?: string; curl?: string }
```

`force?: boolean`:用户在校验失败后点「仍然保存」时为 `true`,后端据此跳过探针直接落盘。

- `key`:发起校验的模型选项 key(前端据此只让对应弹窗响应)。
- `ok`:探针是否通过。
- `message`:失败原因(成功可省)。
- `curl`:失败时的可复制调试命令(来自 `ApiTestResult.curlCommand`)。

广播下发(沿用现有 bus 广播架构);非发起方的客户端因 `key !== keyModalFor` 天然忽略。

## 后端流程(`sema-bridge.ts` 的 `internal:set-key` 改为「先校验后保存」)

1. `envKey = envKeyForModel(m.key)`;为空 → 回 `error`(同现状)。
2. `val = m.apiKey.trim()`;为空 → 回 `error`。
3. 从 `buildModelRegistry()` 取该 key 的 `cfg`,构造
   `params = { provider: cfg.provider, baseURL: cfg.baseURL, modelName: cfg.modelName, apiKey: val, adapt: cfg.adapt }`。
4. 跳过探针:若 `m.force`(用户点了「仍然保存」)或 `this.core` 不存在,直接走成功路径保存。
5. 否则 `const r = await this.core.testApiConnection(params)`(整段包 try/catch,异常按失败处理)。
6. **成功**(`r.success` 或跳过探针):
   - `saveKeyOverride(envKey, val)`;
   - 若 `resolveModel().selected === m.key` → `applyModel` 真正激活;
   - `emitModelConfig()`;
   - 发 `model:key-result{ key, ok:true }`。
7. **失败**:不写盘、不动任何状态,发
   `model:key-result{ key, ok:false, message: r.message, curl: r.curlCommand }`。

## 前端流程(`TopBar.tsx` 填 key 弹窗)

新增状态:`keyChecking: boolean`、`keyError: { message?: string; curl?: string } | null`。

- 点保存(`submitKey`):`send({ type:'model:set-key', key, apiKey })` → 置 `keyChecking=true, keyError=null`,**不立即关弹窗**。
- `useEffect` 里 `getWsClient().on(...)` 监听 `model:key-result`,仅认 `m.key === keyModalFor`:
  - `keyChecking=false`;
  - `ok` → 关弹窗、清空输入与状态;
  - 失败 → `keyError = { message, curl }`,保留已输入的 key 让用户改。
- 弹窗渲染:
  - `keyChecking` 时保存按钮显示「校验中…」并禁用(取消仍可用);
  - `keyError` 时:红字原因(多行自适应)+ 一个可复制的 curl 块(带复制按钮)
    + 一个「仍然保存(跳过校验)」按钮 → `submitKey(true)` 发 `force`;
  - 关闭 / 切换目标模型时重置 `keyChecking` `keyError`。
- 注意 `submitKey(force=false)`:保存按钮须用 `onClick={() => submitKey(false)}` 包一层,
  否则 `onClick={submitKey}` 会把 `MouseEvent` 当作 `force` 传入 → 每次保存都跳过校验。

## 非目标(YAGNI)

- 不给已配置模型加「重新校验」按钮。
- 不给自定义模型(custom-add)加校验(本次只覆盖内置未配置模型填 key)。
- 不做周期性健康检查。
