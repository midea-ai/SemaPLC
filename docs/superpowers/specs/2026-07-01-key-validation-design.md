# 填 key 时校验链路 — 设计

日期:2026-07-01
关联:模型面板「未配置模型填 key」功能(见 `sema-plc-web` 的 `key-overrides.ts` / `TopBar.tsx` 填 key 弹窗)。

## 目标

用户在弹窗里为「未配置」的内置已验证模型填入 API key 并点保存时,后端**先发一次短请求探链路**,通了才把 key 持久化;不通则不保存、原地告诉用户为什么。

## 决策(已敲定)

- **策略 A:测不过就不保存,原地报错。** 保证落盘的 key 都是当时探通的。
- **只在填 key 保存这一次校验。** 不做周期性 / 重复重测。
- **运行时 key 失效** 沿用现有 `session:error` 提示,**绝不删** 已存的 key。
- **失败信息带上可复制的 curl 调试命令**,方便手动排查是 key 错还是端点抽风。
- 已知代价:高延迟中转端点的探针偶发误报,会把对的 key 挡在外面(用户接受)。

## 校验探针(现成能力)

SemaCore 实例暴露 `testApiConnection(params: ApiTestParams): Promise<ApiTestResult>`:
- `ApiTestParams = { provider?, baseURL, apiKey, modelName, adapt }`
- 内部对目标端点发一个最小 completion(让模型回 "YES"),响应含 "YES" 即 `success:true`。
- `ApiTestResult = { success: boolean; message: string; curlCommand?: string }`
- **独立于会话模型**,不影响当前正在用的 active 模型。

## 消息契约

新增一条服务端→前端消息(`shared/protocol.ts` 的 `ServerMessage`):

```ts
{ type: 'model:key-result'; key: string; ok: boolean; message?: string; curl?: string }
```

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
4. 兜底:若 `this.core` 不存在,跳过校验直接按成功路径保存(极少见,不阻塞用户)。
5. `const r = await this.core.testApiConnection(params)`(整段包 try/catch,异常按失败处理)。
6. **成功**(`r.success`):
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
  - `keyError` 时:红字原因(多行自适应)+ 一个可复制的 curl 块(带复制按钮);
  - 关闭 / 切换目标模型时重置 `keyChecking` `keyError`。

## 非目标(YAGNI)

- 不给已配置模型加「重新校验」按钮。
- 不给自定义模型(custom-add)加校验(本次只覆盖内置未配置模型填 key)。
- 不做周期性健康检查。
