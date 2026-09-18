---
name: semaplc
description: 在任意 Agent 环境中用 SemaPLC 工具链编写、验证和仿真 IEC 61131-3 ST 语言的 PLC 程序(matiec + OpenPLC Runtime v4)。SemaPLC toolchain skill — author, verify and simulate ST PLC programs against a local OpenPLC Runtime via the plc-tools CLI or MCP server.
---

# SemaPLC 集成 Skill

用 SemaPLC 工具链(`@sema/plc-tools`)完成 ST 程序的「编写 → 编译 → 运行 → 验证 → 仿真」闭环。两种接入方式等价:

- **CLI**(推荐,零配置):`node <repo>/sema-plc-tools/dist/cli.js <command>`
- **MCP**:注册 `plc-tools` stdio 服务(`node <repo>/sema-plc-tools/dist/cli.js serve`),得到 `plc_compile` / `plc_buildAndRun` / `plc_verifyBehavior` 等 16 个工具

## 定位仓库与前置检查

`<repo>` 按以下顺序解析:环境变量 `SEMAPLC_REPO` → `~/develop/SemaPLC` → `~/SemaPLC`。

```bash
REPO="${SEMAPLC_REPO:-$HOME/develop/SemaPLC}"
CLI="$REPO/sema-plc-tools/dist/cli.js"
mkdir -p /tmp/plc-ver-ws/src/programs

# ① dist 未构建 → 构建一次
[ -f "$CLI" ] || (cd "$REPO/sema-plc-tools" && npm install && npm run build)

# ② OpenPLC Runtime 容器必须运行(REST API https://localhost:8443)
docker start openplc-plc-dev 2>/dev/null || \
  (cd "$REPO/sema-plc-tools/runtime" && docker compose up -d --build)

node "$CLI" status   # → { status, isRunning, runtimeReachable }
```

`runtimeReachable:false` 时先修容器,不要继续写程序。

## 核心命令

### 验证 PLC 程序(最常用)

```bash
cd /tmp/plc-ver-ws && node "$CLI" verify plan.json
```

输出 JSON 信封,`ok:true` 表示编译、运行、全部断言通过。失败时错误在 `failure.detail.errors[]`(带行/列与出错源码行),修复 `.st` 后重跑。

### 其余常用命令

| 命令 | 用途 |
|------|------|
| `status` | 运行时状态探活 |
| `compile <file.st>` | 仅编译,打印结构化错误 |
| `buildAndRun <file.st>` | 完整部署链:编译 → 上传 → 启动 |
| `readVariables [--names a,b]` | 读取实时变量值 |
| `force --set start_btn=true` | 模拟 `%IX`/`%IW` 输入(支持 `--pulseMs`) |
| `trace --names led --durationMs 3000` | 时间序列采样(定时器/状态机) |
| `waitFor <var> <op> <value>` | 轮询直到条件成立 |
| `detectIO <file.st>` | 抽取 `AT %…` 定位 IO 面 |
| `node "$CLI" --help` | 全部命令 |

## 工作流程

1. 根据需求编写 ST 程序 → 写入 `/tmp/plc-ver-ws/src/programs/<name>.st`
   - 单文件必须恰好包含一个 `PROGRAM` 与一个 `CONFIGURATION`
   - 多文件工程用 `stPaths`/`projectDir`(MCP)或目录参数(CLI)
2. 编写 `plan.json`:1–3 个代表性工况,每工况 = 部署 + 输入序列 + 断言
3. 运行 `verify` 验证
4. 有编译错误 → 按 `failure.detail.errors[]` 修复后重跑;行为不符 → 用 `trace`/`readVariables` 观察定位
5. 验证通过 → 调用 MCP `plc_buildSimulation` 生成随运行值动起来的 SVG 过程画面

## ST 编写要点

- 定时器 `TON`/`TOF` 实例需 `VAR` 声明;`%IX/%QX/%IW/%QW` 为定位 IO
- `CONFIGURATION` 里 `TASK(INTERVAL := t#20ms, PRIORITY := 1)`
- 扫描周期内禁止 `WHILE TRUE`;状态机用显式 `CASE`
- 数值比较注意 `INT` 溢出;时间常量写 `t#30s` 形式

## 参考

- 16 个工具的完整 I/O 契约:`<repo>/sema-plc-tools/src/types.ts`
- 工具速查:`<repo>/sema-plc-tools/README.md` §5
- 声明式验证 plan 格式:`<repo>/docs/wiki/tools/verify-runner.md`
