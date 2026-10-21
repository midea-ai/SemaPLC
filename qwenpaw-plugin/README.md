# SemaPLC — QwenPaw 插件

把 [SemaPLC](https://github.com/midea-ai/SemaPLC) 的 PLC 工具链接入 QwenPaw:
`semaplc` 技能(ST 编写 → 编译 → 运行 → 验证 → 过程仿真的完整工作流)+
`/semaplc` 入口命令 + `plc-tools` MCP 配置。

> 安装本插件**之前**需要本地已有 SemaPLC 仓库并完成构建与运行时容器,
> 插件本身不携带 PLC 工具链,只负责把智能体指过去。

## 前置(一次性)

```bash
git clone https://github.com/midea-ai/SemaPLC ~/develop/SemaPLC
cd ~/develop/SemaPLC/sema-plc-tools
npm install && npm run build        # 也可不构建:MCP 首次启动经 scripts/semaplc-mcp.sh 自动构建
cd runtime && docker compose up -d --build   # OpenPLC Runtime v4,https://localhost:8443
```

仓库不在默认位置时 `export SEMAPLC_REPO=/路径/到/SemaPLC`(写入 QwenPaw 的环境或启动 shell)。

## 安装

```bash
qwenpaw plugin install <SemaPLC仓库>/qwenpaw-plugin
qwenpaw plugin reload        # 或重启 QwenPaw
```

## 注册 MCP(可选但推荐)

QwenPaw 的 MCP 客户端由控制台管理,插件不代写配置。两种等效方式:

1. 在 QwenPaw 聊天里执行 `/semaplc mcp`,复制输出的 JSON;
2. 或打开控制台 **智能体 → MCP → + 创建**,粘贴
   [`mcp/semaplc.mcp.json`](mcp/semaplc.mcp.json)(把绝对路径换成自己的)。

注册后智能体获得 `plc_compile` / `plc_buildAndRun` / `plc_verifyBehavior` 等
16 个工具。只想要精简工具面(`plc_status`/`plc_readVariables`/`plc_getLogs`/
`plc_detectIO`/`plc_buildSimulation`/`plc_stop`)时,把 `args` 改为
`["…/dist/cli.js", "serve", "--lite"]`,验证走 `verify` CLI 运行器。

## 使用

| 命令 | 作用 |
|---|---|
| `/semaplc <需求>` | 智能体按 semaplc 技能跑完整流程(ST → 编译 → 运行 → verify → 仿真) |
| `/semaplc status` | 探测本地仓库与 `dist/cli.js` 是否就绪,并给出修复指引 |
| `/semaplc mcp` | 打印已解析绝对路径的 MCP 配置 JSON |

不带命令直接对话也能命中技能:提问里出现「PLC / ST / 梯形图 / OpenPLC」等意图时,
`semaplc` 技能会被自动加载。

## 校验与卸载

```bash
qwenpaw plugin validate <SemaPLC仓库>/qwenpaw-plugin
qwenpaw plugin uninstall semaplc   # 自动清理注入到工作区的技能
```

## 文件

| 文件 | 说明 |
|---|---|
| `plugin.json` | QwenPaw 插件清单 |
| `plugin.py` | 技能提供者 + `/semaplc` 命令;仅做只读路径探测,不执行外部命令 |
| `skills/semaplc/SKILL.md` | 与仓库根 `skills/semaplc/SKILL.md` 同源(改一处要同步两处) |
| `mcp/semaplc.mcp.json` | 手动导入用的 MCP 配置模板 |
