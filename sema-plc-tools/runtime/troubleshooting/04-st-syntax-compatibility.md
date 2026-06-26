# 04 - ST语言语法兼容性问题

## 问题描述

原始的`simple_counter.st`文件在matiec编译时出现大量语法错误：

```
/workspace/samples/simple_counter.st:12-5..12-22: error: invalid located variable declaration.
12 |     counter : INT := 0;
   |     ^~~~~~~~~~~~~~~~~~

/workspace/samples/simple_counter.st:20-5..20-11: error: invalid variable before ':=' in ST assignment statement.
20 |     running := NOT running;
   |     ^~~~~~~

15 error(s) found. Bailing out!
```

## 根本原因

1. **变量声明混合**：在同一个VAR块中混合使用located和非located变量声明
2. **初始化位置错误**：在VAR声明中进行初始化，而matiec期望在程序逻辑中初始化
3. **语句分隔符**：某些语句缺少分号分隔符
4. **matiec版本限制**：matiec v4.0.11对IEC 61131-3语法的支持有特定要求

## 原始代码问题分析

```st
PROGRAM counter_program
VAR
    (* Located input variables *)
    start_button AT %IX0.0 : BOOL := FALSE;  ❌ Located变量不应在VAR中初始化
    reset_button AT %IX0.1 : BOOL := FALSE;  ❌ 同上
    
    (* Located output variables *)
    counter_value AT %QW0 : INT := 0;         ❌ 同上
    running_led AT %QX0.0 : BOOL := FALSE;   ❌ 同上
    
    (* Internal variables *)
    counter : INT := 0;                       ❌ 非located变量在VAR中不被允许
    running : BOOL := FALSE;                  ❌ 同上
END_VAR
```

## 解决方案

### 方案1：分离变量声明（推荐）

```st
PROGRAM counter_program
VAR
    (* Located input variables - 只声明，不初始化 *)
    start_button AT %IX0.0 : BOOL;
    reset_button AT %IX0.1 : BOOL;
    
    (* Located output variables *)
    counter_value AT %QW0 : INT;
    running_led AT %QX0.0 : BOOL;
END_VAR
VAR_TEMP
    (* Internal variables - 使用VAR_TEMP *)
    counter : INT;
    running : BOOL;
    last_start : BOOL;
    last_reset : BOOL;
END_VAR

(* 在程序逻辑中进行初始化 *)
counter := 0;
running := FALSE;
last_start := FALSE;
last_reset := FALSE;

(* 程序逻辑... *)
END_PROGRAM
```

### 方案2：全部使用Located变量

```st
PROGRAM counter_program
VAR
    start_button AT %IX0.0 : BOOL;
    reset_button AT %IX0.1 : BOOL;
    counter_value AT %QW0 : INT;
    running_led AT %QX0.0 : BOOL;
    
    (* 为内部变量分配内存位置 *)
    counter AT %MW0 : INT;
    running AT %MX0.0 : BOOL;
    last_start AT %MX0.1 : BOOL;
    last_reset AT %MX0.2 : BOOL;
END_VAR
```

## 修复实施

创建兼容的`simple_counter_fixed.st`：

```st
PROGRAM counter_program
VAR
    (* Located input variables *)
    start_button AT %IX0.0 : BOOL;
    reset_button AT %IX0.1 : BOOL;
    
    (* Located output variables *)
    counter_value AT %QW0 : INT;
    running_led AT %QX0.0 : BOOL;
END_VAR
VAR_TEMP
    (* Internal variables *)
    counter : INT;
    running : BOOL;
    last_start : BOOL;
    last_reset : BOOL;
END_VAR

(* Initialize variables *)
counter := 0;
running := FALSE;
last_start := FALSE;
last_reset := FALSE;

(* Rising edge detection for start button *)
IF start_button AND NOT last_start THEN
    running := NOT running;
END_IF;
last_start := start_button;

(* Rising edge detection for reset button *)
IF reset_button AND NOT last_reset THEN
    counter := 0;
    running := FALSE;
END_IF;
last_reset := reset_button;

(* Counter logic *)
IF running THEN
    counter := counter + 1;
    IF counter > 9999 THEN
        counter := 0;
    END_IF;
END_IF;

(* Output assignments *)
counter_value := counter;
running_led := running;

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : counter_program;
END_RESOURCE
END_CONFIGURATION
```

## matiec语法规则总结

基于测试结果，matiec v4.0.11的语法要求：

1. **VAR块规则**：
   - 只能包含located变量声明（带AT子句）
   - 不允许在声明中初始化
   - 不允许非located变量

2. **VAR_TEMP块规则**：
   - 可以包含非located变量
   - 变量在程序开始时自动初始化为默认值
   - 适用于临时计算和状态存储

3. **语句规则**：
   - 所有赋值语句必须在程序逻辑部分
   - IF语句必须以分号结束
   - 建议显式添加分号提高兼容性

## 测试验证

```bash
# 测试修复后的ST文件
cd /tmp
ln -sf /usr/local/share/matiec/lib lib
iec2c -f -p -i -l /workspace/samples/simple_counter_fixed.st

# 验证编译成功
echo "Compilation result: $?"
ls -la *.c *.h *.csv
```

期望输出：
```
Compilation result: 0
Config0.c  Config0.h  POUS.c  POUS.h  Res0.c  LOCATED_VARIABLES.h  VARIABLES.csv
```

## 影响范围

- **开发影响**：需要调整ST代码编写规范
- **示例文件**：原有示例需要更新以符合matiec要求
- **文档影响**：需要更新ST语法指南

## 最佳实践

1. **变量声明**：严格区分located和非located变量
2. **初始化**：在程序逻辑中显式初始化变量
3. **语法检查**：使用matiec进行语法验证
4. **兼容性测试**：针对目标编译器版本测试代码

## 相关文件

- `samples/simple_counter.st`: 原始示例（有语法问题）
- `samples/simple_counter_fixed.st`: 修复后的兼容版本
- `reference/iec61131-3-st-reference.md`: ST语法参考
- `scripts/plc_build.sh`: 构建脚本（使用修复版本）