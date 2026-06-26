---
name: plc-fix-compile-error
description: 当 verify 信封报 failure.stage=compile/gcc/start 时定位错误行并修复 ST 代码，重跑同一条 verify 命令，循环直到通过或达到 3 轮上限
---

# 修复 PLC 编译错误

**由 verify 信封 `failure.stage = compile` 触发。** 修复 `.st` 后**重跑同一条 verify 命令**:

```
node __PLC_TOOLS_CLI__ verify plan.json
```

**不要找单独的编译工具**(plc_compile/plc_buildAndRun 等)——它们在本环境不可用,编译只发生在 verify 命令里。

## 输入

上一次 verify 的 stdout JSON 信封(看 `failure.stage` + `failure.detail`)。

## 决策树

```
看 failure.stage:
  'compile' → 步骤 1(解析 detail 里的 iec2c errors)
  'gcc'     → 步骤 4(先源头修正,再考虑简化)
  'start'   → 步骤 5(看 runtime logs)
  其它      → 不归本 skill(plan/caseSetup/assert 的处置见 AGENTS.md 失败分支表)
```

## 步骤

### 步骤 1:解析 iec2c errors(failure.stage === 'compile')

- **先判死输出**:若错误 `line:0` 且带 `advice`,这是声明了 `%Q` 却从不赋值的"死输出"校验——直接照 `errors[0].advice` 补驱动或删声明,不用数行;否则按下面解析真编译错。
- 取 `failure.detail.errors[]`,按 `line` 升序排序
- **只看第一条**(最早的 error)。后面的常常是连锁错误,先修第一条
- 优先用 `error.sourceLine`(信封已带报错行原文)确认报错内容,再用 `view_file` 打开 ST 源码文件跳到 error.line 附近

### 步骤 2:根据 error.message 匹配修复策略

参考 AGENTS.md "常见 iec2c 错误 → 修复策略" 表:

- `invalid located variable declaration` → AT 位地址错,检查 BOOL 是否带点(`%IX0.0`)
- `type mismatch` → 加 `INT_TO_REAL` / `BOOL_TO_INT` 等显式转换
- `invalid variable before ':='` → 检查左侧变量是否声明
- `undefined symbol` → 检查 POU 名拼写
- `unexpected token` / `syntax error near END_IF` / `END_CASE` / `END_FOR` → matiec 强制要求结束关键字带分号(`END_IF;`、`END_CASE;`、`END_FOR;`),补分号即可
- `undefined identifier` / `undeclared` 且报错行是 FB 调用 → agent 常写 `fbTimer(IN:=..., PT:=...)` 但忘在 VAR 段声明实例,补 `fbTimer : TON;`(或对应 FB 类型)
- FB 调用输出参数 `invalid assignment` / output type mismatch → 输出参数应用 `=>` 而非 `:=`(如 `Q => bDone`)
- `syntax error` near `ELSE` 且代码中写了 `ELSE IF` → ST 关键字是 `ELSIF`(一个词),改为 `ELSIF condition THEN`
- 其它 → 综合 message + 源码上下文判断

### 步骤 3:应用修复并重试

- 用 `patch_file` 改 ST 源码(只改这一处)
- 立即重跑同一条 verify 命令
- 看新信封:
  - `ok: true` 或失败已不在 compile 段 → 编译修复完成 ✓(后续 stage 各归各的处置)
  - 仍 `stage: 'compile'` 且 errors 数减少 → 回到步骤 1
  - 仍 `stage: 'compile'` 且 errors 数未减少 → 退到步骤 6
  - `stage: 'gcc'` → 进入步骤 4
  - 已尝试 3 轮 → 步骤 6

> 轮数计法:每重跑一次 verify 得一个新信封,**已尝试轮数 = 你本次任务里为修编译错而跑出的信封个数**(从对话里的信封数出来,别凭感觉)。

### 步骤 4:GCC 失败简化策略(failure.stage === 'gcc')

GCC 错通常是 matiec 把 ST 翻成 C 后用了不支持的特性。

**先尝试源头修正**:读 `failure.detail` 里的 stderr 定位报错的 C 行,反推对应的 ST 写法问题(如 `DINT` 改 `INT`、避免不支持的隐式类型转换、去掉 matiec 不完整支持的语法)。如果能通过调整 ST 源码解决,优先这样做,不要急于删功能。

若源头修正无效,按顺序简化:

1. 删掉自定义 FUNCTION / FUNCTION_BLOCK,把逻辑直接写在 PROGRAM 里
2. 删掉位运算(AND/OR/XOR 在位上的操作)
3. 删掉 ARRAY / STRUCT
4. 只保留 PROGRAM + CONFIGURATION + 基础 IF/CASE + 标准 POU(CTU/TON 等)

每次简化一项,重跑 verify。简化到第 4 项还失败 → 步骤 6。

### 步骤 5:运行时启动失败(failure.stage === 'start')

- 调 `mcp__plc-tools__plc_getLogs` 拿日志
- 看返回的 `runtimeErrors[]`:
  - `runtimeErrors[].type` 给出错误类别
  - `runtimeErrors[].advice` 给出修复方向
- 根据 advice 改代码逻辑(不是语法),重跑 verify

### 步骤 6:报告 stuck

向用户报告:
- 已尝试的修复轮次(= 信封个数)
- 最后一次信封的 `failure.stage` + 前 3 条 errors
- 你的诊断与卡点
- 请用户人工介入

## 退出条件

| 退出原因 | 输出 |
|---|---|
| 成功 | "✓ PLC 程序编译通过"(引用新信封;若 case 也全过则一并引用 summary + stHash) |
| 3 轮内未收敛 | "✗ 已尝试 N 轮修复,请人工介入。最后 failure.stage: X,剩余 errors: [...]" |
| 不可恢复(runtime 不可达等基础设施问题) | "✗ 基础设施问题:[详情]"——报告用户,勿自行装包改环境 |

## 不允许的行为

- **不要循环超过 3 轮**。Token 浪费 + 用户失去耐心
- **不要批量改 ST**。一次一处,立即重跑
- **不要忽略 failure.stage**。每次失败都严格按 stage 决定下一步;`caseSetup`/`assert` 不是编译错,不归本 skill
