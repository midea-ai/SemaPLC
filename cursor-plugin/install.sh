#!/usr/bin/env bash
# SemaPLC → Cursor 全局 MCP 注册脚本(幂等)。
#
# 把 plc-tools MCP 服务器(经 scripts/semaplc-mcp.sh 包装,dist 缺失时首次
# 启动自动构建)写入 ~/.cursor/mcp.json(Cursor 全局 MCP 配置),并把 semaplc
# 技能复制到 ~/.cursor/skills/semaplc/。
# Cursor 的 mcp.json 不支持 ${workspaceFolder},因此这里写死解析后的绝对路径;
# 已有同键条目会被替换(自动带时间戳备份),其他服务器不受影响。
#
#   ./install.sh            安装/更新
#   ./install.sh --remove   移除 semaplc 条目与技能副本
#   ./install.sh --dry-run  只打印将要写入的内容
set -euo pipefail

SERVER_KEY="semaplc"
SKILL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/skills/semaplc"
CURSOR_DIR="${HOME}/.cursor"
MCP_FILE="${CURSOR_DIR}/mcp.json"
SKILL_DST="${CURSOR_DIR}/skills/semaplc"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="${REPO}/scripts/semaplc-mcp.sh"
CLI="${REPO}/sema-plc-tools/dist/cli.js"

MODE="install"
DRY=0
for a in "$@"; do
  case "$a" in
    --remove)  MODE="remove" ;;
    --dry-run) DRY=1 ;;
    *) echo "未知参数: $a(支持 --remove / --dry-run)" >&2; exit 2 ;;
  esac
done

py() { python3 - "$@"; }

if [ "$MODE" = "remove" ]; then
  [ -f "$MCP_FILE" ] && py "$MCP_FILE" "$SERVER_KEY" <<'PY'
import json, shutil, sys, time
path, key = sys.argv[1], sys.argv[2]
data = json.load(open(path))
servers = data.get("mcpServers", {})
if key in servers:
    shutil.copy2(path, f"{path}.bak.{time.strftime('%Y%m%d-%H%M%S')}")
    del servers[key]
    json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
    print(f"[cursor] 已从 {path} 移除 '{key}'(备份已生成)")
else:
    print(f"[cursor] {path} 中没有 '{key}',跳过")
PY
  rm -rf "$SKILL_DST"
  echo "[cursor] 已移除技能副本 $SKILL_DST"
  exit 0
fi

if [ ! -f "$WRAPPER" ]; then
  echo "[cursor] ✗ 找不到 $WRAPPER — 本脚本必须与 SemaPLC 仓库一起使用" >&2
  exit 1
fi
if [ ! -f "$CLI" ]; then
  echo "[cursor] ℹ dist/cli.js 尚未构建;scripts/semaplc-mcp.sh 会在 Cursor 首次"
  echo "         启动 MCP 时自动 npm install + npm run build(需要 npm registry 可达)。"
fi

if [ "$DRY" = "1" ]; then
  echo "[cursor] 将向 $MCP_FILE 写入(并备份原文件):"
  cat <<JSON
{
  "mcpServers": {
    "${SERVER_KEY}": {
      "command": "bash",
      "args": ["${WRAPPER}", "serve"],
      "env": { "PLC_URL": "https://localhost:8443", "PLC_CONTAINER": "openplc-plc-dev" }
    }
  }
}
JSON
  echo "[cursor] 将复制技能 $SKILL_SRC → $SKILL_DST"
  exit 0
fi

py "$MCP_FILE" "$SERVER_KEY" "$WRAPPER" <<'PY'
import json, os, shutil, sys, time
path, key, wrapper = sys.argv[1], sys.argv[2], sys.argv[3]
if os.path.isfile(path):
    shutil.copy2(path, f"{path}.bak.{time.strftime('%Y%m%d-%H%M%S')}")
    try:
        data = json.load(open(path))
    except json.JSONDecodeError as e:
        sys.exit(f"[cursor] {path} 不是合法 JSON({e});已备份原文件,请修复后重试")
else:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = {}
servers = data.setdefault("mcpServers", {})
entry = servers.get(key) or {}
env = dict(entry.get("env") or {})
env.update({
    "PLC_URL": os.environ.get("PLC_URL", "https://localhost:8443"),
    "PLC_CONTAINER": os.environ.get("PLC_CONTAINER", "openplc-plc-dev"),
})
servers[key] = {"command": "bash", "args": [wrapper, "serve"], "env": env}
json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
print(f"[cursor] ✓ 已写入 {path}(其他 mcpServers 条目保持不变,原文件已备份)")
PY

mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -r "$SKILL_SRC" "$SKILL_DST"
echo "[cursor] ✓ 技能已复制到 $SKILL_DST"
echo "[cursor] 完成。在 Cursor(Ctrl/Cmd+Shift+P → 'MCP: List Servers')确认 'semaplc' 已启动;"
echo "         OpenPLC 容器需自行保持运行:docker start openplc-plc-dev"
