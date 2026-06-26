#!/bin/bash
# PLC Build Script - ST source to OpenPLC Runtime deployment
# Usage: ./plc_build.sh <st_file> [runtime_url] [auth_token]

set -euo pipefail

# Default values
RUNTIME_URL="${2:-https://localhost:8443}"
TOKEN="${3:-}"
VERBOSE="${VERBOSE:-0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        echo -e "${BLUE}[VERBOSE]${NC} $1"
    fi
}

# Check arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <st_file> [runtime_url] [auth_token]"
    echo "Environment variables:"
    echo "  RUNTIME_URL - OpenPLC Runtime URL (default: https://localhost:8443)"
    echo "  VERBOSE - Enable verbose output (0/1, default: 0)"
    exit 1
fi

ST_FILE="$1"

# Validate input file
if [ ! -f "$ST_FILE" ]; then
    log_error "ST file not found: $ST_FILE"
    exit 1
fi

# Check required tools
for tool in iec2c xml2st curl zip; do
    if ! command -v "$tool" &> /dev/null; then
        log_error "Required tool not found: $tool"
        exit 1
    fi
done

# Create temporary working directory
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

log_info "Starting PLC build process..."
log_verbose "Working directory: $WORK_DIR"
log_verbose "ST file: $ST_FILE"
log_verbose "Runtime URL: $RUNTIME_URL"

# Copy ST file to working directory
cp "$ST_FILE" "$WORK_DIR/program.st"
cd "$WORK_DIR"

# Create symlink to matiec library files
ln -sf /usr/local/share/matiec/lib lib

# Step 1: Compile ST to C using matiec
log_info "[1/8] Compiling ST to C using matiec..."
if iec2c -f -p -i -l program.st 2> iec2c.log; then
    log_success "ST compilation completed"
    log_verbose "Generated files: $(ls -1 *.c *.h *.csv 2>/dev/null || echo 'none')"
else
    log_error "ST compilation failed"
    echo "matiec output:"
    cat iec2c.log
    exit 1
fi

# Verify required files were generated
required_files=("Config0.c" "Config0.h" "Res0.c" "POUS.c" "POUS.h" "LOCATED_VARIABLES.h" "VARIABLES.csv")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        log_error "Missing required file: $file"
        exit 1
    fi
done

# Step 2: Generate debug.c
log_info "[2/8] Generating debug.c using xml2st..."
if xml2st --generate-debug program.st VARIABLES.csv 2> xml2st_debug.log; then
    log_success "debug.c generated"
else
    log_error "debug.c generation failed"
    echo "xml2st output:"
    cat xml2st_debug.log
    exit 1
fi

# Step 3: Generate glueVars.c
log_info "[3/8] Generating glueVars.c using xml2st..."
if xml2st --generate-gluevars LOCATED_VARIABLES.h 2> xml2st_glue.log; then
    log_success "glueVars.c generated"
else
    log_error "glueVars.c generation failed"
    echo "xml2st output:"
    cat xml2st_glue.log
    exit 1
fi

# Step 4: Prepare c_blocks_code.cpp and c_blocks.h
log_info "[4/8] Preparing C blocks files..."
if [ ! -f "c_blocks_code.cpp" ]; then
    cat > c_blocks_code.cpp << 'EOF'
// Auto-generated empty C blocks template for PLC Agent
extern "C" {
    // No custom C/C++ function blocks defined
    // This file is required by OpenPLC Runtime compilation
}
EOF
    log_verbose "Created empty c_blocks_code.cpp template"
fi

# Create c_blocks.h header file (required by OpenPLC Runtime)
cat > c_blocks.h << 'EOF'
// Auto-generated empty C blocks header for PLC Agent
// This file is required by OpenPLC Runtime compilation

#ifndef C_BLOCKS_H
#define C_BLOCKS_H

// No custom C/C++ function blocks defined

#endif // C_BLOCKS_H
EOF
log_verbose "Created empty c_blocks.h header"

# Step 5: Copy matiec lib/ directory
log_info "[5/8] Copying matiec library files..."
LIB_SOURCE="/usr/local/share/matiec/lib"
if [ -d "$LIB_SOURCE" ]; then
    # Remove symlink and copy actual files for packaging
    rm -f lib
    cp -r "$LIB_SOURCE" ./lib
    log_success "Library files copied"
    log_verbose "Library files: $(find lib -name '*.h' | wc -l) header files"
else
    log_error "matiec library directory not found: $LIB_SOURCE"
    exit 1
fi

# Step 6: Package ZIP file
log_info "[6/8] Creating program package..."
ZIP_FILES=("Config0.c" "Config0.h" "Res0.c" "POUS.c" "POUS.h" "LOCATED_VARIABLES.h" "debug.c" "glueVars.c" "c_blocks_code.cpp" "c_blocks.h" "lib/")

# Verify all files exist before zipping
for item in "${ZIP_FILES[@]}"; do
    if [ ! -e "$item" ]; then
        log_error "Missing file/directory for packaging: $item"
        exit 1
    fi
done

if zip -r program.zip "${ZIP_FILES[@]}" > /dev/null 2>&1; then
    ZIP_SIZE=$(du -h program.zip | cut -f1)
    log_success "Package created: program.zip ($ZIP_SIZE)"
else
    log_error "Failed to create ZIP package"
    exit 1
fi

# Step 7: Upload to OpenPLC Runtime
log_info "[7/8] Uploading to OpenPLC Runtime..."

# Prepare curl headers
CURL_HEADERS=()
if [ -n "$TOKEN" ]; then
    CURL_HEADERS=("-H" "Authorization: Bearer $TOKEN")
fi

# Upload file
UPLOAD_RESPONSE=$(curl -k -s -w "\n%{http_code}" -X POST "$RUNTIME_URL/api/upload-file" \
    "${CURL_HEADERS[@]}" \
    -F "file=@program.zip" 2>/dev/null)

HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UPLOAD_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" -eq 200 ]; then
    log_success "Upload completed"
    log_verbose "Response: $RESPONSE_BODY"
else
    log_error "Upload failed (HTTP $HTTP_CODE)"
    echo "Response: $RESPONSE_BODY"
    exit 1
fi

# Step 8: Wait for compilation
log_info "[8/8] Waiting for compilation..."
TIMEOUT=60
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    STATUS_RESPONSE=$(curl -k -s "$RUNTIME_URL/api/compilation-status" \
        "${CURL_HEADERS[@]}" 2>/dev/null || echo '{"status":"ERROR"}')
    
    STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('status', 'UNKNOWN'))
except:
    print('ERROR')
" 2>/dev/null || echo "ERROR")

    case "$STATUS" in
        "SUCCESS")
            log_success "Compilation completed successfully!"
            echo
            log_info "Build summary:"
            echo "  - ST file: $ST_FILE"
            echo "  - Package size: $ZIP_SIZE"
            echo "  - Runtime URL: $RUNTIME_URL"
            echo
            log_info "Next steps:"
            echo "  - Start PLC: curl -k '$RUNTIME_URL/api/start-plc'"
            echo "  - Check status: curl -k '$RUNTIME_URL/api/status'"
            echo "  - View logs: curl -k '$RUNTIME_URL/api/runtime-logs'"
            exit 0
            ;;
        "FAILED")
            log_error "Compilation failed!"
            echo "Compilation details:"
            echo "$STATUS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATUS_RESPONSE"
            exit 1
            ;;
        "IDLE"|"UNZIPPING"|"COMPILING")
            log_verbose "Compilation status: $STATUS (${ELAPSED}s elapsed)"
            ;;
        *)
            log_warn "Unknown compilation status: $STATUS"
            ;;
    esac
    
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

log_error "Compilation timeout after ${TIMEOUT}s"
exit 1
