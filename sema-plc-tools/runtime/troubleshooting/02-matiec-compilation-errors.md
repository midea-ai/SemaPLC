# 02 - matiec编译器相关问题

## 问题描述

matiec (iec2c)编译器在运行时出现多种错误：

### 错误1：库文件路径问题
```
Error opening library file lib/ieclib.txt: No such file or directory
```

### 错误2：库文件语法错误（构建时）
```
standard_functions.txt:1738-64..1738-71: error: invalid input variable(s) declaration.
in file included from file lib/ieclib.txt:29
32 error(s) found in lib/ieclib.txt. Bailing out!
```

## 根本原因

1. **工作目录问题**：iec2c期望在当前目录下找到`lib/`子目录
2. **库文件位置**：matiec库文件安装在`/usr/local/share/matiec/lib`，但iec2c在当前目录查找
3. **版本兼容性**：不同版本的matiec库文件可能存在语法差异

## 解决方案

### 方案1：符号链接方法（推荐）

在每次使用iec2c前创建符号链接：

```bash
# 在工作目录中创建lib符号链接
ln -sf /usr/local/share/matiec/lib lib

# 然后运行iec2c
iec2c -f -p -i -l program.st
```

### 方案2：环境变量方法

```bash
# 设置库文件路径环境变量（如果支持）
export MATIEC_LIB_PATH=/usr/local/share/matiec/lib
```

### 方案3：复制库文件方法

```bash
# 复制库文件到当前目录
cp -r /usr/local/share/matiec/lib ./lib
```

## 实施细节

### 修改验证脚本

在`scripts/verify_environment.sh`中添加：

```bash
# Create symlink to matiec library files
ln -sf /usr/local/share/matiec/lib lib
```

### 修改构建脚本

在`scripts/plc_build.sh`中添加：

```bash
# Create symlink to matiec library files
ln -sf /usr/local/share/matiec/lib lib

# 编译后需要删除符号链接，复制实际文件用于打包
rm -f lib
cp -r /usr/local/share/matiec/lib lib
```

## 库文件内容验证

检查关键库文件：

```bash
# 验证库文件存在
ls -la /usr/local/share/matiec/lib/
# 应该包含：
# - iec_std_lib.h
# - iec_types.h  
# - iec_std_FB.h
# - standard_functions.txt
# - 等等

# 检查ieclib.txt内容
head -20 /usr/local/share/matiec/lib/ieclib.txt
```

## 影响范围

- **阻塞性影响**：无法编译任何ST程序
- **影响阶段**：ST源码到C代码转换阶段
- **影响工具**：主要是iec2c，iec2iec也可能受影响

## 测试方法

```bash
# 测试基本编译功能
cd /tmp
ln -sf /usr/local/share/matiec/lib lib
echo 'PROGRAM test
VAR a:BOOL; END_VAR  
END_PROGRAM
CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK t(INTERVAL:=TIME#100ms,PRIORITY:=0);
PROGRAM i WITH t:test;
END_RESOURCE
END_CONFIGURATION' > test.st

iec2c -f -p -i -l test.st
ls -la *.c *.h
```

期望输出：
```
Config0.c  Config0.h  POUS.c  POUS.h  Res0.c  LOCATED_VARIABLES.h  VARIABLES.csv
```

## 相关文件

- `Dockerfile.plc-dev`: matiec安装和库文件配置
- `scripts/verify_environment.sh`: 环境验证脚本
- `scripts/plc_build.sh`: PLC构建脚本