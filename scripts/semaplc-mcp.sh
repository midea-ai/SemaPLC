#!/usr/bin/env bash
# SemaPLC MCP 启动包装:确保 sema-plc-tools/dist/cli.js 存在后 exec node。
#
# 插件市场(Claude /plugin install、git clone 后直接用)拿到的仓库副本没有
# dist/(git-ignored),首次启动 MCP 时在本目录内自动 npm install + build。
# 构建输出走 stderr/stdout 重定向,避免污染 MCP 的 stdio JSON-RPC 流。
#
# 用法: scripts/semaplc-mcp.sh [serve|verify|… 任意 plc-tools CLI 参数]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/sema-plc-tools"
CLI="$TOOLS/dist/cli.js"

if [ ! -f "$CLI" ]; then
  echo "[semaplc] dist/ 缺失,首次构建 sema-plc-tools(需要 node 18+ 与 npm registry 可达)…" >&2
  ( cd "$TOOLS" && npm install --no-audit --no-fund && npm run build ) >&2
  echo "[semaplc] 构建完成" >&2
fi

exec node "$CLI" "$@"
