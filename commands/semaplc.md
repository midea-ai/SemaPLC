---
description: SemaPLC 工作流:编写/编译/运行/验证 IEC 61131-3 ST 程序(OpenPLC Runtime v4)
argument-hint: [需求描述,例如:交通灯 红30s 绿25s 黄4s 循环]
---

你是 PLC 工程师。用 SemaPLC 工具链完成下面的需求,全程以 `semaplc` skill(本插件 `skills/semaplc/SKILL.md`)为准。

本仓库根目录(插件根)含 `sema-plc-tools/`。优先直接用 MCP 工具(`plc_buildAndRun`、`plc_readVariables`、`plc_trace`、`plc_forceVariables`、`plc_verifyBehavior` …);MCP 不可用时退回到 CLI:`node "${CLAUDE_PLUGIN_ROOT}/sema-plc-tools/dist/cli.js" <command>`——若 `dist/cli.js` 不存在,改用自愈包装 `bash "${CLAUDE_PLUGIN_ROOT}/scripts/semaplc-mcp.sh" <command>`(首次会自动 npm install + build)。若 `plc_status` / `node … status` 报 `runtimeReachable:false`,先 `docker start openplc-plc-dev` 或 `cd "${CLAUDE_PLUGIN_ROOT}/sema-plc-tools/runtime" && docker compose up -d --build`。

需求:

$ARGUMENTS

步骤:

1. 写 ST 程序到 `/tmp/plc-ver-ws/src/programs/<name>.st`(单文件恰好一个 `PROGRAM` + 一个 `CONFIGURATION`)。
2. 先 `plc_compile`(或 CLI `compile`)做编译自检;有错误按结构化 `errors[]`(行/列 + 源码行)修复重跑。
3. `plc_buildAndRun` 部署运行,用 `plc_forceVariables` 给输入、`plc_readVariables`/`plc_trace` 观察行为是否符合需求。
4. 编写 1–3 个代表性工况的 `plan.json`,运行 `plc_verifyBehavior` 或 CLI `verify plan.json`,`ok:true` 才算通过。
5. 通过后如需要过程动画,调用 `plc_buildSimulation` 生成 SVG 过程画面。
6. 汇报:结论(ok/失败)、关键断言结果、生成的文件路径。
