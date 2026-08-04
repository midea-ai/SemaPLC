# 独立 CLI

除了作为 MCP 服务,`sema-plc-tools` 本身是一个完整的命令行工具(bin 名 `plc-tools`,入口 `src/cli.ts`,基于 commander),无需 agent 即可在终端直接驱动 OpenPLC。

前置:先在 `sema-plc-tools/` 跑 `npm run build`,并确保运行时容器已起(见 [OpenPLC 运行时环境](wiki/tools/runtime))。

## 常用命令

```bash
cd sema-plc-tools
node dist/cli.js status                                # 运行时状态(运行中 exit 0)
node dist/cli.js compile program.st                    # 编译并打印结构化结果 JSON
node dist/cli.js buildAndRun program.st                # 编译 → 上传 → 启动
node dist/cli.js readVariables --names led,motor       # 读实时变量值
node dist/cli.js trace --names led --durationMs 3000   # 随时间采样某个变量
node dist/cli.js force --set start_btn=true            # 模拟一个输入
node dist/cli.js waitFor red_led eq true               # 轮询至条件成立
node dist/cli.js verify plan.json                      # 跑一个声明式验证 plan
node dist/cli.js serve                                 # 改以 MCP stdio 服务方式运行
```

## 全部子命令

| 命令 | 说明 / 主要选项 |
|---|---|
| `serve [--lite]` | 以 MCP stdio server 运行;`--lite` 收窄工具面 |
| `verify <planFile> [--only <caseName>]` | 跑声明式 verify plan(build → drive cases → assert → cleanup),stdout 打印 JSON envelope;runner 在 `src/verify/` |
| `status` | 快速状态检查 |
| `compile <file>` | 编译 ST 文件并打印结构化 JSON |
| `detectIO <file>` | 抽取 `AT` 定位 IO 并打印 IO map |
| `genModbusConfig <file> [--host] [--port]` | 从定位 IO 生成 modbus_slave 插件配置(默认 `0.0.0.0:502`) |
| `readVariables [--names] [--timeoutMs]` | 读实时变量值 |
| `buildAndRun <file>` | 完整部署环:编译 → 上传 → 启动 |
| `force [--set n=v,…] [--release] [--pulseMs] [--pulseScans] [--timeoutMs]` | 强制/释放变量 |
| `trace [--names] [--intervalMs] [--durationMs] [--samples] [--timeoutMs]` | 时间序列采样 |
| `waitFor <varName> <op> <value> [--timeoutMs] [--intervalMs]` | 轮询等待;op 支持 shell 友好的 `eq ne gt ge lt le`,也接受引号包的 `== != > >= < <=` |
| `genScene <file>` | 从 ST 定位 IO 自动建议过程仿真的 Scene Spec |

## 声明式验证(verify plan)

`verify` 命令消费一个 JSON plan 文件,完整跑一遍"构建 → 逐 case 驱动输入 → 断言 → 清理"流程,结果以结构化 JSON envelope 输出到 stdout,适合 CI 与 Agent 消费。runner 实现在 `sema-plc-tools/src/verify/`(`runner.ts` / `caseExec.ts` / `planParse.ts` 等)。

plan 的 schema 参考 `sema-plc-web/templates/.sema/skills/plc-build-and-verify/plan-schema.md`。
