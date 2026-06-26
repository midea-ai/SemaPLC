# 05 - OpenPLC Runtime编译失败问题

## 问题描述

PLC程序包上传到OpenPLC Runtime后，GCC编译阶段失败：

### 错误1：缺少头文件
```
[ERROR] core/generated/lib/iec_std_FB.h:1936:10: fatal error: ../c_blocks.h: No such file or directory
[ERROR]  1936 | #include "../c_blocks.h"
[ERROR]       |          ^~~~~~~~~~~~~~~
```

### 错误2：缺少POUS.h
```
[ERROR] core/generated/Config0.c:10:10: fatal error: POUS.h: No such file or directory
[ERROR]    10 | #include "POUS.h"
[ERROR]       |          ^~~~~~~~
```

### 错误3：缺少Config0.h
```
[ERROR] core/generated/Res0.c:15:10: fatal error: Config0.h: No such file or directory
[ERROR]    15 | #include "Config0.h"
[ERROR]       |          ^~~~~~~~~~~
```

## 根本原因

1. **文件缺失**：上传的ZIP包中缺少OpenPLC Runtime编译所需的关键文件
2. **依赖关系**：C代码文件之间存在复杂的包含关系，必须包含所有依赖文件
3. **构建系统期望**：OpenPLC Runtime期望特定的文件结构和命名规范

## 必需文件清单

基于分析和测试，完整的PLC程序包必须包含：

### matiec生成的文件
- `Config0.c` - 配置源码
- `Config0.h` - 配置头文件  
- `Res0.c` - 资源源码
- `POUS.c` - 程序组织单元源码
- `POUS.h` - 程序组织单元头文件
- `LOCATED_VARIABLES.h` - 定位变量声明

### xml2st生成的文件
- `debug.c` - 调试支持代码
- `glueVars.c` - 变量绑定代码

### 必需的支持文件
- `c_blocks_code.cpp` - C/C++自定义功能块（可为空）
- `c_blocks.h` - C/C++功能块头文件（必需）
- `lib/` - matiec库文件目录

## 解决方案

### 1. 完善ZIP包内容

修改构建脚本，确保包含所有必需文件：

```bash
# 在scripts/plc_build.sh中
ZIP_FILES=(
    "Config0.c" 
    "Config0.h"      # ✅ 新增
    "Res0.c" 
    "POUS.c"         # ✅ 新增
    "POUS.h"         # ✅ 新增  
    "LOCATED_VARIABLES.h"
    "debug.c" 
    "glueVars.c"
    "c_blocks_code.cpp" 
    "c_blocks.h"     # ✅ 新增
    "lib/"
)
```

### 2. 创建缺失的支持文件

```bash
# 创建c_blocks.h头文件
cat > c_blocks.h << 'EOF'
// Auto-generated empty C blocks header for PLC Agent
// This file is required by OpenPLC Runtime compilation

#ifndef C_BLOCKS_H
#define C_BLOCKS_H

// No custom C/C++ function blocks defined

#endif // C_BLOCKS_H
EOF

# 创建c_blocks_code.cpp（如果不存在）
cat > c_blocks_code.cpp << 'EOF'
// Auto-generated empty C blocks template for PLC Agent
extern "C" {
    // No custom C/C++ function blocks defined
    // This file is required by OpenPLC Runtime compilation
}
EOF
```

### 3. 验证文件生成

在构建过程中添加验证步骤：

```bash
# 验证matiec生成的所有必需文件
required_files=("Config0.c" "Config0.h" "Res0.c" "POUS.c" "POUS.h" "LOCATED_VARIABLES.h" "VARIABLES.csv")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        log_error "Missing required file: $file"
        exit 1
    fi
done
```

## 编译成功验证

### 测试完整构建流程

```bash
# 创建完整的测试包
cd /tmp && mkdir test_complete && cd test_complete

# 准备源文件
cp /workspace/samples/simple_counter_fixed.st program.st
ln -sf /usr/local/share/matiec/lib lib

# 执行编译链
iec2c -f -p -i -l program.st
xml2st --generate-debug program.st VARIABLES.csv
xml2st --generate-gluevars LOCATED_VARIABLES.h

# 创建支持文件
cat > c_blocks_code.cpp << 'EOF'
extern "C" {
}
EOF

cat > c_blocks.h << 'EOF'
#ifndef C_BLOCKS_H
#define C_BLOCKS_H
#endif
EOF

# 准备库文件
rm -f lib && cp -r /usr/local/share/matiec/lib lib

# 创建完整包
zip -r program.zip Config0.c Config0.h Res0.c POUS.c POUS.h LOCATED_VARIABLES.h debug.c glueVars.c c_blocks_code.cpp c_blocks.h lib/

# 上传并测试
TOKEN=$(curl -k -s -X POST https://localhost:8443/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys, json; print(json.load(sys.stdin).get("access_token", "ERROR"))')

curl -k -s -X POST https://localhost:8443/api/upload-file \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@program.zip"

# 监控编译状态
for i in {1..30}; do
    STATUS=$(curl -k -s https://localhost:8443/api/compilation-status -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys, json; print(json.load(sys.stdin).get("status", "UNKNOWN"))')
    echo "[$i] $STATUS"
    [ "$STATUS" = "SUCCESS" ] && break
    [ "$STATUS" = "FAILED" ] && break
    sleep 2
done
```

期望结果：
```
[1] COMPILING
[2] SUCCESS
```

## 常见错误排查

### 1. 检查包内容
```bash
unzip -l program.zip
# 确认所有必需文件都在包中
```

### 2. 验证文件格式
```bash
# 检查关键头文件
head -10 POUS.h
head -5 Config0.h
head -5 c_blocks.h
```

### 3. 查看编译日志
```bash
curl -k -s https://localhost:8443/api/compilation-status -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## 性能优化

1. **预生成模板**：将常用的支持文件预生成为模板
2. **增量验证**：只验证变化的文件
3. **并行处理**：同时进行文件生成和验证

## 影响范围

- **阻塞性影响**：无法部署任何PLC程序到Runtime
- **开发流程**：影响整个ST → 部署的流程
- **测试验证**：影响端到端测试的执行

## 相关文件

- `scripts/plc_build.sh`: 主要构建脚本
- `scripts/verify_environment.sh`: 环境验证脚本
- `samples/simple_counter_fixed.st`: 测试用ST程序
- `troubleshooting/04-st-syntax-compatibility.md`: ST语法相关问题