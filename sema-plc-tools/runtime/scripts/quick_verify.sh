#!/bin/bash
# 宿主机一键验证脚本（在 W1-D1-D2 目录下执行）
# 流程：启动容器 → 鉴权 → 调用容器内 verify_environment.sh → 端到端 ST 编译验证

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[FAIL]${NC} $1"; }

# 必须在 W1-D1-D2 目录执行
if [ ! -f docker-compose.yml ]; then
    log_error "请在 W1-D1-D2 目录下执行该脚本"
    exit 1
fi

# 兼容 docker compose / docker-compose
if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
else
    DC="docker-compose"
fi

# Step 1: 启动容器
log_info "Step 1: 启动容器..."
if $DC ps --status running 2>/dev/null | grep -q openplc-plc-dev; then
    log_success "容器已在运行"
else
    $DC up -d --build
    log_info "等待 Runtime 启动 (30s)..."
    sleep 30
fi

# Step 2: API 可达性
log_info "Step 2: 测试 API 可达性..."
if curl -k -s --max-time 5 https://localhost:8443/api/ping >/dev/null 2>&1; then
    log_success "API 可达"
else
    log_error "API 不可达"
    exit 1
fi

# Step 3: 创建用户 + 登录
log_info "Step 3: 鉴权..."
curl -k -s -X POST https://localhost:8443/api/create-user \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' >/dev/null 2>&1 || true

TOKEN=$(curl -k -s -X POST https://localhost:8443/api/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
    log_error "鉴权失败"
    exit 1
fi
log_success "鉴权成功"

# Step 4: 容器内运行环境自检
log_info "Step 4: 容器内自检（matiec / xml2st / lib / API）..."
if $DC exec -T openplc-runtime /workspace/scripts/verify_environment.sh; then
    log_success "容器内自检通过"
else
    log_error "容器内自检失败"
    exit 1
fi

# Step 5: 端到端 ST 编译验证（用真实样例）
log_info "Step 5: 端到端编译验证 (samples/simple_counter_fixed.st)..."
if $DC exec -e RUNTIME_URL=https://localhost:8443 openplc-runtime \
        /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st \
        https://localhost:8443 "$TOKEN"; then
    log_success "ST → 编译 → 上传 → GCC 编译 全链路通过"
else
    log_error "端到端编译失败"
    exit 1
fi

echo
echo "========================================================"
log_success "W1-D1-D2 环境验证完成！"
echo
log_info "已验证："
echo "  - Docker 容器部署"
echo "  - matiec + xml2st + Runtime 三件套统一在镜像内可用"
echo "  - REST API 鉴权与端点"
echo "  - ST → C → ZIP → 上传 → GCC 编译完整链路"
echo
log_info "下一步：W1 D3 - 手工全链路验证脚本细化"
echo "========================================================"
