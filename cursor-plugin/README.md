# SemaPLC — Cursor 插件支持

让 Cursor 的 Agent 用上 SemaPLC PLC 工具链:`plc-tools` MCP 服务器(16 个
`plc_*` 工具)+ `semaplc` 技能(ST 编写 → 编译 → 运行 → 验证 → 过程仿真)。

> 前置:本地已有 SemaPLC 仓库,且 `sema-plc-tools` 已完成
> `npm install && npm run build`;OpenPLC Runtime 容器在运行
> (`cd sema-plc-tools/runtime && docker compose up -d --build`)。

## 方式 A:全局安装脚本(推荐)

写入 `~/.cursor/mcp.json`(幂等,自动备份,不影响其他 MCP 条目)并把技能
复制到 `~/.cursor/skills/semaplc/`,对**所有项目**生效:

```bash
cd <SemaPLC仓库>/cursor-plugin
./install.sh            # 安装/更新
./install.sh --dry-run  # 预览
./install.sh --remove   # 卸载
```

然后在 Cursor 里 `Ctrl/Cmd+Shift+P → MCP: List Servers` 确认 `semaplc` 正在运行
(首次需在 MCP 设置面板启用)。

## 方式 B:项目级配置

本仓库自带 `.cursor/rules/semaplc.mdc` 与 `.cursor/skills/semaplc/`,在 Cursor
打开本仓库即生效;MCP 配置在 `cursor-plugin/mcp.json`,内容使用
`${env:SEMAPLC_REPO}` 展开(Cursor 支持 `${env:VAR}`,但不支持
`${workspaceFolder}`):

```bash
export SEMAPLC_REPO=/绝对路径/到/SemaPLC   # 需对 Cursor 进程可见
cp cursor-plugin/mcp.json .cursor/mcp.json
```

GUI 启动的 Cursor 看不到 shell 环境变量时,改用方式 A,或把
`mcp.json` 里的 `${env:SEMAPLC_REPO}` 手动替换为绝对路径。

## 使用

- Agent 对话中提出 PLC 需求(如「写一个交通灯 ST 程序并验证」),
  `semaplc` 技能会被自动加载;
- MCP 工具:`plc_status` / `plc_compile` / `plc_buildAndRun` /
  `plc_forceVariables` / `plc_trace` / `plc_verifyBehavior` /
  `plc_buildSimulation` 等,契约见仓库根 `sema-plc-tools/src/types.ts`。

## 文件

| 文件 | 说明 |
|---|---|
| `install.sh` | 全局注册脚本(合并写入 `~/.cursor/mcp.json` + 技能复制) |
| `mcp.json` | 项目级 MCP 配置模板(`${env:SEMAPLC_REPO}` 版) |

Cursor 的项目级规则/技能已放在仓库 `.cursor/` 下(`rules/semaplc.mdc`、
`skills/semaplc/SKILL.md`),与仓库根 `skills/semaplc/SKILL.md` 同源,改动需同步。
