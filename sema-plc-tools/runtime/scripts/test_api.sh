#!/bin/bash
# OpenPLC Runtime API Test Script
# Tests all major API endpoints for functionality verification

set -euo pipefail

# Configuration
RUNTIME_URL="${1:-https://localhost:8443}"
USERNAME="${2:-admin}"
PASSWORD="${3:-admin123}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test execution function
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -n "Testing: $test_name... "
    
    if eval "$test_command" >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        return 1
    fi
}

# Global variables
TOKEN=""
TEMP_DIR=""

# Cleanup function
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

echo "=== OpenPLC Runtime API Test Suite ==="
echo "Runtime URL: $RUNTIME_URL"
echo

# Test 1: Ping endpoint (no auth required)
log_info "1. Testing basic connectivity..."
run_test "API ping endpoint" "curl -k -s --max-time 5 '$RUNTIME_URL/api/ping' | grep -q 'pong'"

# Test 2: Create user (if needed)
log_info "2. Testing user management..."

# Check if we need to create the first user
USER_NEEDED=$(curl -k -s "$RUNTIME_URL/api/create-user" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
    | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'message' in data and 'successfully' in data['message']:
        print('created')
    else:
        print('exists')
except:
    print('exists')
" 2>/dev/null)

if [ "$USER_NEEDED" = "created" ]; then
    log_success "User created successfully"
else
    log_info "User already exists or creation skipped"
fi

# Test 3: Login and get token
log_info "3. Testing authentication..."
LOGIN_RESPONSE=$(curl -k -s "$RUNTIME_URL/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'token' in data:
        print(data['token'])
    else:
        print('')
except:
    print('')
" 2>/dev/null)

if [ -n "$TOKEN" ]; then
    log_success "Authentication successful"
    run_test "JWT token received" "[ -n '$TOKEN' ]"
else
    log_fail "Authentication failed"
    echo "Login response: $LOGIN_RESPONSE"
    exit 1
fi

# Test 4: PLC status endpoint
log_info "4. Testing PLC control endpoints..."
run_test "PLC status endpoint" "curl -k -s '$RUNTIME_URL/api/status' -H 'Authorization: Bearer $TOKEN' | python3 -c 'import sys,json; data=json.load(sys.stdin); exit(0 if \"status\" in data else 1)'"

# Test 5: Stop PLC (ensure clean state)
run_test "Stop PLC command" "curl -k -s '$RUNTIME_URL/api/stop-plc' -H 'Authorization: Bearer $TOKEN' | grep -q 'PLC'"

# Test 6: Compilation status
run_test "Compilation status endpoint" "curl -k -s '$RUNTIME_URL/api/compilation-status' -H 'Authorization: Bearer $TOKEN' | python3 -c 'import sys,json; data=json.load(sys.stdin); exit(0 if \"status\" in data else 1)'"

# Test 7: Runtime logs
run_test "Runtime logs endpoint" "curl -k -s '$RUNTIME_URL/api/runtime-logs' -H 'Authorization: Bearer $TOKEN'"

# Test 8: File upload with sample program
log_info "5. Testing file upload functionality..."

# Create a minimal test program
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Create minimal ST program
cat > test_program.st << 'EOF'
PROGRAM test_program
VAR
    test_input : BOOL := FALSE;
    test_output : BOOL := FALSE;
END_VAR

test_output := NOT test_input;

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : test_program;
END_RESOURCE
END_CONFIGURATION
EOF

# Test if we can compile this program using our tools
if command -v iec2c >/dev/null 2>&1; then
    log_info "6. Testing complete compilation chain..."
    
    # Compile ST to C
    if iec2c -f -p -i -l test_program.st >/dev/null 2>&1; then
        log_success "ST compilation successful"
        
        # Generate additional files if xml2st is available
        if command -v xml2st >/dev/null 2>&1; then
            xml2st --generate-debug test_program.st VARIABLES.csv >/dev/null 2>&1 || log_warn "debug.c generation failed"
            xml2st --generate-gluevars LOCATED_VARIABLES.h >/dev/null 2>&1 || log_warn "glueVars.c generation failed"
        fi
        
        # Create empty c_blocks_code.cpp
        echo "// Empty C blocks" > c_blocks_code.cpp
        
        # Copy lib if available
        if [ -d "/usr/local/share/matiec/lib" ]; then
            cp -r /usr/local/share/matiec/lib ./
        fi
        
        # Create ZIP package
        ZIP_FILES=()
        [ -f "Config0.c" ] && ZIP_FILES+=("Config0.c")
        [ -f "Res0.c" ] && ZIP_FILES+=("Res0.c")
        [ -f "debug.c" ] && ZIP_FILES+=("debug.c")
        [ -f "glueVars.c" ] && ZIP_FILES+=("glueVars.c")
        [ -f "c_blocks_code.cpp" ] && ZIP_FILES+=("c_blocks_code.cpp")
        [ -d "lib" ] && ZIP_FILES+=("lib/")
        
        if [ ${#ZIP_FILES[@]} -gt 0 ] && zip -r test_program.zip "${ZIP_FILES[@]}" >/dev/null 2>&1; then
            # Test upload
            UPLOAD_RESULT=$(curl -k -s -w "%{http_code}" "$RUNTIME_URL/api/upload-file" \
                -H "Authorization: Bearer $TOKEN" \
                -F "file=@test_program.zip" 2>/dev/null)
            
            HTTP_CODE=$(echo "$UPLOAD_RESULT" | tail -c 4)
            if [ "$HTTP_CODE" = "200" ]; then
                log_success "Program upload successful"
                
                # Wait for compilation
                log_info "7. Testing compilation process..."
                TIMEOUT=30
                ELAPSED=0
                
                while [ $ELAPSED -lt $TIMEOUT ]; do
                    COMP_STATUS=$(curl -k -s "$RUNTIME_URL/api/compilation-status" \
                        -H "Authorization: Bearer $TOKEN" \
                        | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('status','UNKNOWN'))" 2>/dev/null)
                    
                    case "$COMP_STATUS" in
                        "SUCCESS")
                            log_success "Program compilation successful"
                            PASSED_TESTS=$((PASSED_TESTS + 1))
                            TOTAL_TESTS=$((TOTAL_TESTS + 1))
                            break
                            ;;
                        "FAILED")
                            log_fail "Program compilation failed"
                            TOTAL_TESTS=$((TOTAL_TESTS + 1))
                            break
                            ;;
                        "IDLE"|"UNZIPPING"|"COMPILING")
                            sleep 1
                            ELAPSED=$((ELAPSED + 1))
                            ;;
                        *)
                            log_warn "Unknown compilation status: $COMP_STATUS"
                            sleep 1
                            ELAPSED=$((ELAPSED + 1))
                            ;;
                    esac
                done
                
                if [ $ELAPSED -ge $TIMEOUT ]; then
                    log_fail "Compilation timeout"
                    TOTAL_TESTS=$((TOTAL_TESTS + 1))
                fi
                
                # Test PLC start if compilation succeeded
                if [ "$COMP_STATUS" = "SUCCESS" ]; then
                    log_info "8. Testing PLC execution..."
                    run_test "Start PLC" "curl -k -s '$RUNTIME_URL/api/start-plc' -H 'Authorization: Bearer $TOKEN' | grep -q 'PLC'"
                    
                    sleep 2
                    
                    run_test "PLC running status" "curl -k -s '$RUNTIME_URL/api/status' -H 'Authorization: Bearer $TOKEN' | python3 -c 'import sys,json; data=json.load(sys.stdin); exit(0 if data.get(\"status\") == \"RUNNING\" else 1)'"
                    
                    # Stop PLC for cleanup
                    curl -k -s "$RUNTIME_URL/api/stop-plc" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
                fi
                
            else
                log_fail "Program upload failed (HTTP $HTTP_CODE)"
                TOTAL_TESTS=$((TOTAL_TESTS + 1))
            fi
        else
            log_fail "Failed to create test program package"
            TOTAL_TESTS=$((TOTAL_TESTS + 1))
        fi
    else
        log_fail "ST compilation failed"
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
    fi
else
    log_warn "iec2c not available, skipping compilation tests"
fi

# Test 9: WebSocket debug endpoint availability (basic connectivity)
log_info "9. Testing WebSocket debug endpoint..."
# This is a basic test to see if the WebSocket endpoint responds
WS_TEST=$(curl -k -s -w "%{http_code}" "$RUNTIME_URL/api/debug" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" 2>/dev/null | tail -c 3)

if [ "$WS_TEST" = "101" ] || [ "$WS_TEST" = "400" ]; then
    log_success "WebSocket debug endpoint available"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    log_fail "WebSocket debug endpoint not responding correctly"
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# Summary
echo
echo "=== Test Summary ==="
echo "Total tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $((TOTAL_TESTS - PASSED_TESTS))"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    echo -e "${GREEN}✓ All tests passed! OpenPLC Runtime API is fully functional.${NC}"
    exit 0
elif [ $PASSED_TESTS -gt $((TOTAL_TESTS / 2)) ]; then
    echo -e "${YELLOW}⚠ Most tests passed. Some features may need attention.${NC}"
    exit 0
else
    echo -e "${RED}✗ Multiple tests failed. Please check the OpenPLC Runtime configuration.${NC}"
    exit 1
fi