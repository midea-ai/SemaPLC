# MCP 工具参考

`sema-plc-tools` 通过 MCP(stdio)暴露 16 个可组合的 PLC 工具。工具注册的唯一权威在 `sema-plc-tools/src/server.ts` 的 `TOOLS` 常量,每个工具的 handler 在 `src/tools/*.ts`,I/O 类型契约在 `src/types.ts`。

本页是速查表;实现机制见各深度页:[编译与部署管线](wiki/tools/compile-pipeline)、[语法检查与 IO 检测](wiki/tools/check-and-io)、[运行时客户端与调试协议](wiki/tools/runtime-client)、[观测与验证工具语义](wiki/tools/observation)、[声明式验证 Runner](wiki/tools/verify-runner)、[过程仿真与 Scene Spec](wiki/tools/simulation)、[状态、配置与安全边界](wiki/tools/state-config)。

以 MCP 服务方式运行:

```bash
cd sema-plc-tools
node dist/cli.js serve           # 完整 16 个工具
node dist/cli.js serve --lite    # 精简工具面,见下文
```

## 构建与部署

| 工具 | 功能 |
|---|---|
| `plc_compile` | 编译 ST 源码(iec2c → xml2st → ZIP),返回带行/列号和出错源码行的结构化错误 |
| `plc_check` | 用 rusty(PLC-lang)编译器做语法/语义检查;接受裸 `FUNCTION_BLOCK`/`FUNCTION`(只检查,不保证能在 OpenPLC 上跑) |
| `plc_detectIO` | 纯离线扫描 `AT %…` 声明,抽取定位 IO 面(ST 地址、类型、方向、OpenPLC Modbus 映射) |
| `plc_upload` | 把上次编译的 ZIP 上传到 OpenPLC Runtime 并等待 GCC 编译,返回完整 GCC 日志 |
| `plc_buildAndRun` | 一次调用完成 编译 → 上传 → 启动,分阶段返回结构化结果 |

## 运行控制

| 工具 | 功能 |
|---|---|
| `plc_start` | 启动已加载的 PLC 程序 |
| `plc_stop` | 停止正在运行的 PLC 程序 |
| `plc_status` | 取运行时状态:`EMPTY` / `INIT` / `RUNNING` / `STOPPED` / `ERROR` |
| `plc_getLogs` | 取运行时日志最后 N 行,附 `hasRuntimeErrors` 与 `lastLine` |

## 观测与验证

| 工具 | 功能 |
|---|---|
| `plc_readVariables` | 经 WebSocket 调试协议读变量值(名字大小写不敏感,FB 输出用 `instance.port`) |
| `plc_trace` | 按时间采样变量,验证时序"形状"(定时器推进、状态机轮转、计数器单调);约 50ms 采样下限 |
| `plc_record` | 取 recorder 插件的逐扫描周期录制(20ms/帧),只返回变化点,能看到 trace 看不到的扫描级脉宽/时序 |
| `plc_waitFor` | 轮询单个变量直到比较条件成立或超时(替代手写轮询循环) |
| `plc_forceVariables` | 经 DEBUG_SET 强制/释放变量值以模拟输入;支持 `pulseMs`、tick 级验证的 `pulseScans`、条件触发 `when` |
| `plc_verifyBehavior` | 原子化行为验证:强制输入 → 等待下游条件 → 自动释放。结构上强制断言"持久的下游效果",而非瞬态 |

## 仿真

| 工具 | 功能 |
|---|---|
| `plc_buildSimulation` | 为运行中的程序生成/校验动画过程仿真(Scene Spec),写 `scene.json` 供 UI「过程仿真」页渲染 |

## `--lite` 模式

`serve --lite` 只注册 6 个工具:`plc_status`、`plc_readVariables`、`plc_getLogs`、`plc_detectIO`、`plc_buildSimulation`、`plc_stop`。

设计意图:把验证类工具从 MCP 面上**物理移除**,验证只能走声明式 verify runner(见 [独立 CLI](wiki/tools/cli) 的 `verify` 命令),堵死弱模型退回"force → read"人肉验证老路。`sema-plc-web` 工作区种子里的 `.mcp.json` 默认即以 `--lite` 启动。

## engineless 模式

第三种工具面收窄,可叠加在 `--lite` 之上:环境变量 `PLC_ENGINE=none`(由宿主在探测不到 docker/podman 且无可达远程 OpenPLC 时注入)时,工具面收窄为 2 个纯本地工具:`plc_detectIO`、`plc_buildSimulation`——既不 `docker exec` 也不打 REST。其余工具从 `ListTools` 物理移除,`CallTool` 兜底拒绝并明示"这不是 ST 代码问题,重试无用"。机制详见 [状态、配置与安全边界](wiki/tools/state-config)。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PLC_URL` | `https://localhost:8443` | OpenPLC Runtime 地址 |
| `PLC_CONTAINER` | `openplc-plc-dev` | 容器名 |
| `PLC_USER` / `PLC_PASSWORD` | `admin` / `admin123` | 运行时凭据 |
| `PLC_STATE_FILE` | `~/.plc-tools/state.json` | 缓存 `variableMap` 与 `zipPath` |
| `PLC_ENGINE` | 无 | `none` 时进入 engineless 模式(见上文) |
