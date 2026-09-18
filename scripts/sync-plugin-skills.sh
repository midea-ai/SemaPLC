#!/usr/bin/env bash
# 同步 semaplc 技能的多份副本。仓库根 skills/semaplc/SKILL.md 是唯一权威,
# 另外两处(qwenpaw-plugin/skills、.cursor/skills)是本脚本的复制目标。
# 用法:
#   scripts/sync-plugin-skills.sh          # 同步
#   scripts/sync-plugin-skills.sh --check  # 只校验一致性(CI 可用,不一致时退出码 1)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/skills/semaplc"
TARGETS=("$ROOT/qwenpaw-plugin/skills/semaplc" "$ROOT/.cursor/skills/semaplc")

if [ "${1:-}" = "--check" ]; then
  bad=0
  for t in "${TARGETS[@]}"; do
    if ! diff -q "$SRC/SKILL.md" "$t/SKILL.md" >/dev/null 2>&1; then
      echo "✗ 与权威副本不一致: $t" >&2; bad=1
    fi
  done
  [ "$bad" = 0 ] && echo "✓ semaplc 技能三份副本一致"
  exit "$bad"
fi

for t in "${TARGETS[@]}"; do
  mkdir -p "$t"
  cp "$SRC/SKILL.md" "$t/SKILL.md"
  echo "✓ 已同步 → $t"
done
