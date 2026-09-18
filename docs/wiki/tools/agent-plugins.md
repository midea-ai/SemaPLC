# Agent 插件支持(QwenPaw · Claude Code · Cursor)

`sema-plc-tools` 的 16 个 PLC 工具(以及 IDE 内置 Agent 之外的工作流)已经通过三种官方插件形式交付给外部 Agent 环境。三者共享同一份权威技能文件 [`skills/semaplc/SKILL.md`](https://github.com/midea-ai/SemaPLC/blob/main/skills/semaplc/SKILL.md),并统一经 [`scripts/semaplc-mcp.sh`](https://github.com/midea-ai/SemaPLC/blob/main/scripts/semaplc-mcp.sh) 包装启动 MCP——`dist/` 未构建时,首次启动会自动 `npm install && npm run build`。

| 平台 | 形态 | 入口 | 安装方式 |
|---|---|---|---|
| **QwenPaw** | `qwenpaw-plugin/`(plugin.json + plugin.py + skills + `/semaplc` 命令) | 聊天里 `/semaplc` | `qwenpaw plugin install <repo>/qwenpaw-plugin` |
| **Claude Code** | 仓库根即插件:`.claude-plugin/`(plugin.json + marketplace.json)、`.mcp.json`、`commands/semaplc.md`、`skills/` | `/plugin` 市场安装 | `/plugin marketplace add midea-ai/SemaPLC` → `/plugin install semaplc@semaplc` |
| **Cursor** | `.cursor/`(项目规则+技能)+ `cursor-plugin/install.sh`(全局 MCP 注册脚本) | 直接对 Agent 提 PLC 需求 | `cd cursor-plugin && ./install.sh` |

## 共同前置

- **Node.js ≥ 18**、**Docker**(OpenPLC Runtime v4 容器)
- OpenPLC 容器在运行:`cd sema-plc-tools/runtime && docker compose up -d --build`(或 `docker start openplc-plc-dev`),REST `https://localhost:8443`
- `dist/` 可由包装脚本首启自动构建;网络受限时手动 `cd sema-plc-tools && npm install && npm run build`

## QwenPaw

插件走 QwenPaw 官方 plugin 规范(`plugin.json` 清单 + `plugin.py` 后端):

- `api.register_skill_provider` 把 `semaplc` 技能注入所有工作区(卸载自动回收);
- `api.register_slash_command` 注册 `/semaplc`:
  - `/semaplc <需求>` → 让智能体按技能执行 ST 编写→编译→运行→verify→仿真;
  - `/semaplc status` → 只读探测本地仓库与构建状态;
  - `/semaplc mcp` → 打印已解析绝对路径的 MCP 配置 JSON。

QwenPaw 的 MCP 客户端由控制台管理(智能体 → MCP → + 创建),插件不代写配置:粘贴 `/semaplc mcp` 输出,或参考 [`qwenpaw-plugin/mcp/semaplc.mcp.json`](https://github.com/midea-ai/SemaPLC/blob/main/qwenpaw-plugin/mcp/semaplc.mcp.json)。仓库不在默认位置时设 `SEMAPLC_REPO=<路径>`。

```bash
qwenpaw plugin install <repo>/qwenpaw-plugin
qwenpaw plugin validate <repo>/qwenpaw-plugin   # CI 校验
```

## Claude Code

仓库根目录即 Claude 插件根(`source: "./"`),`.claude-plugin/marketplace.json` 使其同时作为市场仓库:

```
/semaplc 交通灯:红30s 绿25s 黄4s 循环
```

安装(会话内):

```
/plugin marketplace add midea-ai/SemaPLC
/plugin install semaplc@semaplc
```

组件:`.mcp.json` 注册 `semaplc` MCP 服务器(`command: bash`,args 用 `${CLAUDE_PLUGIN_ROOT}/scripts/semaplc-mcp.sh serve`);`commands/semaplc.md` 提供 `/semaplc <需求>` 工作流命令;`skills/semaplc` 为技能(`plugin.json` 里 `"skills": "./skills/"`)。

> 插件安装路径已实测:`claude mcp list` 显示 `plugin:semaplc:semaplc … ✔ Connected`(任意工作目录下 `${CLAUDE_PLUGIN_ROOT}` 均正确展开)。`.mcp.json` 采用 `mcpServers` 包装格式,以便在本仓库被当**普通项目**打开时也能解析——此时该条目会以"待审批"出现且提示 `CLAUDE_PLUGIN_ROOT` 缺失(项目态没有这个变量),不要批准它;项目内用 `claude mcp add semaplc -- bash <repo>/scripts/semaplc-mcp.sh serve` 注册即可。

## Cursor

Cursor 的 `mcp.json` **不支持** `${workspaceFolder}`,所以提供两条路:

1. **全局安装脚本(推荐)**:`cursor-plugin/install.sh` 幂等地把 `semaplc` 条目(绝对路径 + 包装脚本)合并进 `~/.cursor/mcp.json`——自动时间戳备份、保留其他服务器与已有 `env` 键——并把技能复制到 `~/.cursor/skills/semaplc/`。`--dry-run` 预览,`--remove` 卸载。
2. **项目级**:把 `cursor-plugin/mcp.json`(内容用 `${env:SEMAPLC_REPO}` 展开)复制为项目 `.cursor/mcp.json`;GUI 启动的 Cursor 看不到 shell 变量时,把占位符替换成绝对路径。

仓库自带的 `.cursor/rules/semaplc.mdc` 与 `.cursor/skills/semaplc/` 在 Cursor 打开本仓库时即生效(按 glob/描述触发,不常驻)。

## 技能副本一致性

`skills/semaplc/` 为权威,另两份为分发副本:

```bash
scripts/sync-plugin-skills.sh          # 同步
scripts/sync-plugin-skills.sh --check  # CI 校验三份一致
```

## 排错

| 症状 | 处理 |
|---|---|
| MCP 服务器不启动 | 先看 `bash <repo>/scripts/semaplc-mcp.sh status` 是否输出 JSON(它顺带完成首启构建);再看容器 `docker ps | grep openplc-plc-dev` |
| Claude 里 `semaplc` MCP 报找不到文件 | 项目态打开仓库且复用了插件 `.mcp.json`;按上文改用 `claude mcp add` |
| Cursor MCP 面板看不到工具 | 确认改的是 `~/.cursor/mcp.json`(全局)或项目 `.cursor/mcp.json`;重启 Cursor 或在设置里重连 |
| QwenPaw `/semaplc` 提示未找到仓库 | `export SEMAPLC_REPO=/路径/到/SemaPLC`(对 QwenPaw 进程可见) |
| 多 Agent 共用同一套 PLC 状态 | 设计如此:状态缓存默认在 `~/.plc-tools/state.json`;需隔离时设 `PLC_STATE_FILE`(见[状态、配置与安全边界](wiki/tools/state-config)) |

工具面的完整 I/O 契约见 [MCP 工具参考](wiki/tools/mcp-tools);`serve --lite` 的精简工具面见[独立 CLI](wiki/tools/cli)与工具链 README。
