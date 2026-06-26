#!/usr/bin/env bash
#
# build-matiec-base.sh — 从上游 main 源码构建 amd64 MatIEC OpenPLC Runtime 基础镜像。
#
# 背景：ghcr.io/autonomy-logic/openplc-runtime:latest（及全部 SHA tag）已切到
#   STruC++ 分支（v4.1.0-rc3），其 compile.sh 显式拒收 MatIEC 产物
#   （Config0.c / glueVars.c），导致 plc_buildAndRun / plc_upload 在 GCC 阶段失败。
#   上游 main 分支至今仍是 MatIEC，但从未发布镜像。本脚本从 main 源码自建一个
#   amd64 镜像 `openplc-runtime-matiec:main`，供 Dockerfile.plc-dev 当基础镜像。
#
# 用法：./scripts/build-matiec-base.sh   然后  docker compose up -d --build
#
set -euo pipefail

BUILD_DIR="${BUILD_DIR:-/tmp/openplc-matiec-build}"
IMAGE="${IMAGE:-openplc-runtime-matiec:main}"
# 钉死到 STruC++ 切换前最后一个 MatIEC-era 提交，使构建与上游 main 漂移无关、可复现。
# (上游已把 main 切到 STruC++,compile.sh 会拒收 MatIEC 产物;此 commit 仍是 gcc Config0.c。)
PIN_COMMIT="${PIN_COMMIT:-f1a70e91e4d633db3653d1097f9d42e487970a6d}"

rm -rf "$BUILD_DIR"
echo "[1/2] clone openplc-runtime @ ${PIN_COMMIT} (+submodules) -> $BUILD_DIR"
git clone https://github.com/autonomy-logic/openplc-runtime.git "$BUILD_DIR"
git -C "$BUILD_DIR" checkout "$PIN_COMMIT"
git -C "$BUILD_DIR" submodule update --init --recursive

cd "$BUILD_DIR"
if grep -q "no longer supports MatIEC" scripts/compile.sh 2>/dev/null; then
  echo "ERROR: cloned main 的 compile.sh 竟然拒收 MatIEC —— 上游可能已把 main 也切到 STruC++。" >&2
  echo "       需要改 pin 到更早的 MatIEC-era commit（见 git log scripts/compile.sh）。" >&2
  exit 1
fi
echo "  HEAD=$(git rev-parse --short HEAD)  compile.sh=MatIEC-era(gcc Config0.c) ✓"

echo "[2/2] docker build --platform=linux/amd64 -t $IMAGE"
DOCKER_BUILDKIT=1 docker build --platform=linux/amd64 -t "$IMAGE" .

echo "done: $(docker inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')  $IMAGE"
