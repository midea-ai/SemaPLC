#!/usr/bin/env bash
# 三包联合构建 → VSIX(方案 §4.9)。幂等:每次重建 vendor/ 与 media/。
# 用法:sema-plc-vscode/scripts/build-vsix.sh
# 环境变量:
#   SKIP_INSTALL=1  跳过 npm ci(本地已装好依赖时用)
set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$EXT_DIR/.." && pwd)"
TOOLS_DIR="$ROOT/sema-plc-tools"
WEB_DIR="$ROOT/sema-plc-web"

step() { printf '\n=== %s ===\n' "$1"; }
ci() { # $1=目录:装依赖(SKIP_INSTALL=1 跳过)
  if [ "${SKIP_INSTALL:-}" != "1" ]; then (cd "$1" && npm ci); fi
}

step "1/5 plc-tools build"
ci "$TOOLS_DIR"
(cd "$TOOLS_DIR" && npm run build)

step "2/5 web build (dist + dist-server + templates)"
ci "$WEB_DIR"
(cd "$WEB_DIR" && npm run build)

step "3/5 server + plc-tools cli bundle"
rm -rf "$EXT_DIR/vendor" "$EXT_DIR/media"
mkdir -p "$EXT_DIR/vendor/server" "$EXT_DIR/vendor/plc-tools"
# 先铺 plc-tools dist,再跑 esbuild —— 后者会把其中的 cli.js 覆盖成自包含 bundle
# (cli.js 是 sema-core 按 .sema/.mcp.json spawn 的 MCP 子进程,是 dist 里唯一真被
#  node 执行的文件;不 bundle 就得连 94MB 的 plc-tools node_modules 一起打包)。
cp -R "$TOOLS_DIR/dist" "$EXT_DIR/vendor/plc-tools/dist"
# dist/cli.js 是 ESM,但 VSIX 根 package.json 没有 type:module,补一个就近的。
printf '{ "type": "module" }\n' > "$EXT_DIR/vendor/plc-tools/package.json"
# 路线 A(Spike S1 已验证通过):esbuild 单文件 ESM 产物 ~8.8MB。
(cd "$EXT_DIR" && node esbuild.server.mjs)
# @vscode/ripgrep 是 external(只是二进制定位器),连同当前平台的二进制包一起拷到
# bundle 同级 node_modules —— sema-core 用 require.resolve 从 bundle 位置向上找。
mkdir -p "$EXT_DIR/vendor/server/node_modules/@vscode"
cp -R "$WEB_DIR"/node_modules/@vscode/ripgrep* "$EXT_DIR/vendor/server/node_modules/@vscode/"
# ---- 路线 B(备胎:bundle 出问题时改用,体积 +40MB)----
# cp -R "$WEB_DIR/dist-server/." "$EXT_DIR/vendor/server/"
# cp "$WEB_DIR/package.json" "$WEB_DIR/package-lock.json" "$EXT_DIR/vendor/server/"
# cp -R "$WEB_DIR/vendor" "$EXT_DIR/vendor/server/vendor"   # sema-core tgz(file: 依赖)
# (cd "$EXT_DIR/vendor/server" && npm ci --omit=dev)
# 注:路线 B 下入口是 vendor/server/index.js,server-manager spawn 时按此改路径。

step "4/5 copy web/plc-tools/templates"
mkdir -p "$EXT_DIR/media"
cp -R "$WEB_DIR/dist" "$EXT_DIR/media/web"
cp -R "$TOOLS_DIR/runtime" "$EXT_DIR/vendor/plc-tools/runtime"
cp -R "$WEB_DIR/templates" "$EXT_DIR/vendor/templates"

step "5/5 extension bundle + vsce package"
cd "$EXT_DIR"
node esbuild.mjs
npx --yes @vscode/vsce package --no-dependencies

printf '\nVSIX:\n'
ls -lh "$EXT_DIR"/*.vsix
