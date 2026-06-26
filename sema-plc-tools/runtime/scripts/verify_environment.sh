#!/bin/bash
# 容器内环境验证脚本
# 验证 matiec + xml2st + Runtime API 三大组件可用性
#
# 注意：matiec 的 iec2c 没有 --version / -v 选项可用于探活
#       任何带选项不带 ST 文件的调用都会触发 abort/SIGTRAP
#       因此 iec2c 的可用性必须通过"实际编译一个最小 ST 文件"来验证

set -euo pipefail

echo "=== OpenPLC Runtime Development Environment Verification ==="
echo

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

success_count=0
total_tests=0

log_test() {
    local test_name="$1"
    local status="$2"
    total_tests=$((total_tests + 1))
    if [ "$status" = "PASS" ]; then
        echo -e "[${GREEN}PASS${NC}] $test_name"
        success_count=$((success_count + 1))
    else
        echo -e "[${RED}FAIL${NC}] $test_name"
    fi
}

# 准备工作目录与最小 ST 测试文件
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
cd "$WORK_DIR"

cat > simple_test.st << 'EOF'
PROGRAM test_program
VAR
    input_bool : BOOL := FALSE;
    output_bool : BOOL := FALSE;
END_VAR

output_bool := NOT input_bool;

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : test_program;
END_RESOURCE
END_CONFIGURATION
EOF

# Test 1: matiec (iec2c) —— 必须真实编译才能判定
echo "1. Testing matiec (iec2c) via real compilation..."
# Create symlink to matiec library files
ln -sf /usr/local/share/matiec/lib lib
if command -v iec2c >/dev/null \
   && iec2c -f -p -i -l simple_test.st >/dev/null 2>&1 \
   && [ -f Config0.c ] && [ -f Res0.c ] && [ -f LOCATED_VARIABLES.h ] && [ -f VARIABLES.csv ]; then
    log_test "matiec (iec2c) functional" "PASS"
    IEC2C_OK=1
else
    log_test "matiec (iec2c) functional" "FAIL"
    IEC2C_OK=0
fi

# Test 2: xml2st 可用性
echo
echo "2. Testing xml2st..."
if command -v xml2st >/dev/null && xml2st --help >/dev/null 2>&1; then
    log_test "xml2st available" "PASS"
else
    log_test "xml2st available" "FAIL"
fi

# Test 3: matiec lib 头文件
echo
echo "3. Testing matiec library headers..."
LIB_PATH="/usr/local/share/matiec/lib"
required_headers=("iec_std_lib.h" "iec_types_all.h" "iec_types.h")
missing=0
for h in "${required_headers[@]}"; do
    if [ -f "$LIB_PATH/$h" ]; then
        echo "   Found: $h"
    else
        echo "   Missing: $h"
        missing=$((missing + 1))
    fi
done
if [ "$missing" -eq 0 ]; then
    log_test "matiec library headers present" "PASS"
else
    log_test "matiec library headers present" "FAIL"
fi

# Test 4: debug.c 生成（依赖 Test 1 成功）
echo
echo "4. Testing debug.c generation..."
if [ "$IEC2C_OK" = "1" ] \
   && xml2st --generate-debug simple_test.st VARIABLES.csv >/dev/null 2>&1 \
   && [ -f debug.c ]; then
    log_test "debug.c generation" "PASS"
else
    log_test "debug.c generation" "FAIL"
fi

# Test 5: glueVars.c 生成（依赖 Test 1 成功）
echo
echo "5. Testing glueVars.c generation..."
if [ "$IEC2C_OK" = "1" ] \
   && xml2st --generate-gluevars LOCATED_VARIABLES.h >/dev/null 2>&1 \
   && [ -f glueVars.c ]; then
    log_test "glueVars.c generation" "PASS"
else
    log_test "glueVars.c generation" "FAIL"
fi

cd /

# Test 6: REST API 可达性（API 即代表 Runtime 进程存活，无需另测进程名）
echo
echo "6. Testing OpenPLC Runtime API..."
if curl -k -s --max-time 5 https://localhost:8443/api/ping >/dev/null; then
    log_test "OpenPLC Runtime API responding" "PASS"
else
    log_test "OpenPLC Runtime API responding" "FAIL"
fi

# Test 7: 工作空间目录
echo
echo "7. Testing workspace directories..."
workspace_missing=0
for dir in /workspace/samples /workspace/scripts /workspace/output; do
    if [ ! -d "$dir" ]; then
        echo "   Missing: $dir"
        workspace_missing=$((workspace_missing + 1))
    fi
done
if [ "$workspace_missing" -eq 0 ]; then
    log_test "Workspace directories present" "PASS"
else
    log_test "Workspace directories present" "FAIL"
fi

# Summary
echo
echo "=== Verification Summary ==="
echo "Tests passed: $success_count/$total_tests"

if [ "$success_count" -eq "$total_tests" ]; then
    echo -e "${GREEN}All tests passed. Environment is ready.${NC}"
    exit 0
else
    echo -e "${RED}$((total_tests - success_count)) test(s) failed.${NC}"
    exit 1
fi
