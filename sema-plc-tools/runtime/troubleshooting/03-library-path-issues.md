# 03 - 库文件路径配置问题

## 问题描述

### xml2st工具相关错误

在生成调试和胶水代码时失败：

```bash
[FAIL] debug.c generation
[FAIL] glueVars.c generation
```

运行xml2st命令时出现错误或生成空文件。

## 根本原因

1. **依赖文件缺失**：xml2st需要matiec生成的特定文件作为输入
2. **路径引用问题**：xml2st无法正确找到依赖的头文件和CSV文件
3. **权限问题**：生成的文件可能存在权限或格式问题

## 解决方案

### 确保依赖文件完整

xml2st工具需要以下matiec生成的文件：

```bash
# debug.c生成需要：
# - program.st (原始ST文件)
# - VARIABLES.csv (matiec生成)

# glueVars.c生成需要：
# - LOCATED_VARIABLES.h (matiec生成)
```

### 正确的调用顺序

```bash
# 1. 首先运行matiec编译
iec2c -f -p -i -l program.st

# 2. 验证生成的文件
ls -la VARIABLES.csv LOCATED_VARIABLES.h

# 3. 生成debug.c
xml2st --generate-debug program.st VARIABLES.csv

# 4. 生成glueVars.c  
xml2st --generate-gluevars LOCATED_VARIABLES.h

# 5. 验证生成结果
ls -la debug.c glueVars.c
```

### 修复脚本实现

在`scripts/verify_environment.sh`和`scripts/plc_build.sh`中：

```bash
# 确保在正确的工作目录中
cd "$WORK_DIR"

# 创建库文件链接
ln -sf /usr/local/share/matiec/lib lib

# 执行编译
iec2c -f -p -i -l simple_test.st

# 检查生成文件
if [ -f "VARIABLES.csv" ] && [ -f "LOCATED_VARIABLES.h" ]; then
    # 生成debug.c
    xml2st --generate-debug simple_test.st VARIABLES.csv
    
    # 生成glueVars.c
    xml2st --generate-gluevars LOCATED_VARIABLES.h
    
    # 验证结果
    [ -f "debug.c" ] && [ -f "glueVars.c" ]
fi
```

## 常见问题排查

### 1. 文件格式问题

```bash
# 检查VARIABLES.csv格式
head -5 VARIABLES.csv
# 应该包含变量定义信息

# 检查LOCATED_VARIABLES.h格式  
head -10 LOCATED_VARIABLES.h
# 应该包含C语言变量声明
```

### 2. xml2st工具验证

```bash
# 测试xml2st基本功能
xml2st --help

# 检查工具版本
xml2st --version 2>/dev/null || echo "No version command available"
```

### 3. 权限和路径检查

```bash
# 检查工作目录权限
ls -ld $(pwd)

# 检查文件权限
ls -la *.csv *.h

# 检查xml2st可执行权限
which xml2st
ls -la $(which xml2st)
```

## 影响范围

- **功能影响**：无法生成调试支持和变量绑定代码
- **后续影响**：影响OpenPLC Runtime的完整编译流程
- **开发影响**：无法进行PLC程序调试

## 测试验证

完整测试流程：

```bash
#!/bin/bash
cd /tmp
mkdir -p xml2st_test && cd xml2st_test

# 创建库链接
ln -sf /usr/local/share/matiec/lib lib

# 创建测试ST文件
cat > test.st << 'EOF'
PROGRAM test_prog
VAR
    input_var AT %IX0.0 : BOOL;
    output_var AT %QX0.0 : BOOL;
END_VAR
output_var := input_var;
END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK t(INTERVAL:=TIME#100ms,PRIORITY:=0);
    PROGRAM i WITH t:test_prog;
END_RESOURCE
END_CONFIGURATION
EOF

# 执行完整流程
iec2c -f -p -i -l test.st
xml2st --generate-debug test.st VARIABLES.csv
xml2st --generate-gluevars LOCATED_VARIABLES.h

# 验证结果
echo "Generated files:"
ls -la debug.c glueVars.c
echo "debug.c size: $(wc -l < debug.c) lines"
echo "glueVars.c size: $(wc -l < glueVars.c) lines"
```

期望输出：
```
Generated files:
-rw-r--r-- 1 root root 5768 ... debug.c
-rw-r--r-- 1 root root 1234 ... glueVars.c
debug.c size: 123 lines
glueVars.c size: 45 lines
```

## 相关文件

- `scripts/verify_environment.sh`: 环境验证和测试脚本
- `scripts/plc_build.sh`: 完整构建流程脚本
- `Dockerfile.plc-dev`: xml2st工具安装配置