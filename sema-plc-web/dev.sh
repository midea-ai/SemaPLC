#!/usr/bin/env bash
# plc-vis-web 一键启动:OpenPLC 容器 → 编译 plc-tools → 重启 dev server(前台长驻)
#
# 用法:
#   ./dev.sh                       # 默认:deepseek + 思考开
#   PLC_THINKING=0 ./dev.sh        # 关思考(跑 deepseek 强烈建议,避开 8192 输出上限的 max_tokens 截断)
#   PLC_MODEL=minimax-m2.7 ./dev.sh
#   PLC_MODEL=openai ./dev.sh
set -euo pipefail

# 脚本位于 sema-plc-web/,仓库根是其上一级 —— 路径全部相对推导,可任意位置 clone。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ===== 可调参数(均可用环境变量覆盖)=====
PLC_MODEL="${PLC_MODEL:-deepseek}"          # 模型: deepseek / minimax-m2.7 / anthropic / openai / xai / qwen / openai-compatible ...
PLC_THINKING="${PLC_THINKING:-1}"           # 思考: 1=开(默认) 0=关。deepseek 输出上限仅 8192,思考易撑爆 → 建议 0
WORKSPACE="${WORKSPACE:-/tmp/plc-ver-ws}"   # agent 工作区
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"    # API key 来源(从 .env.example 复制)

# ⓪ Docker daemon 守卫(重启后 Docker Desktop 不会自启 → daemon 没跑则自动拉起并等待就绪)
if ! docker info >/dev/null 2>&1; then
  echo "[dev.sh] Docker daemon 未运行,尝试启动 Docker Desktop..."
  open -a Docker
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      echo "[dev.sh] Docker daemon 已就绪"
      break
    fi
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "[dev.sh] 等待 120s 后 Docker daemon 仍未就绪,请手动确认 Docker Desktop 状态后重试" >&2
    exit 1
  fi
fi

# ① OpenPLC 容器(幂等:已跑则跳过 / 停着则 start / 不存在才 compose up)
#    容器名固定为 openplc-plc-dev,不随 compose project 名变 —— 故按容器名判断,
#    避免目录迁移后 project 名变化导致 "container name already in use" 冲突。
if docker ps --format '{{.Names}}' | grep -qx openplc-plc-dev; then
  echo "[dev.sh] 容器 openplc-plc-dev 已运行,跳过"
elif docker ps -a --format '{{.Names}}' | grep -qx openplc-plc-dev; then
  echo "[dev.sh] start 已存在的容器 openplc-plc-dev"
  docker start openplc-plc-dev
else
  ( cd "$ROOT/sema-plc-tools/runtime" && docker-compose up -d )
fi

# ② 重新编译 plc-tools(源码改过必须 build;没改其实可跳,留着保险)
( cd "$ROOT/sema-plc-tools" && npm run build )

# ③ 杀掉正在跑的旧 dev server(前端 5173 + 后端 3001)
lsof -ti:3001,5173 | xargs kill 2>/dev/null || true
sleep 1

# ④ 进 web 目录、导入 API key、启动
cd "$ROOT/sema-plc-web"
if [ -f "$ENV_FILE" ]; then
  echo "[dev.sh] 加载 API key:$ENV_FILE"
  set -a; source "$ENV_FILE"; set +a
else
  echo "[dev.sh] 未找到 $ENV_FILE,改用当前 shell 环境中的 API key(从 .env.example 复制一份更省事)"
fi
echo "[dev.sh] PLC_MODEL=$PLC_MODEL  PLC_THINKING=$PLC_THINKING  WORKSPACE=$WORKSPACE"
PLC_MODEL="$PLC_MODEL" PLC_THINKING="$PLC_THINKING" WORKSPACE="$WORKSPACE" npm run dev
