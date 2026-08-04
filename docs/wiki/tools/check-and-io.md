# 语法检查与 IO 检测

本页讲三个不碰运行时(或只读)的分析工具:`plc_check`(rusty 语法/语义检查)、`plc_detectIO`(离线 IO 扫描)、`genModbusConfig`(Modbus 从站配置生成)。它们与编译部署链的关系见 [编译与部署管线](wiki/tools/compile-pipeline),工具清单见 [MCP 工具参考](wiki/tools/mcp-tools)。

## plc_check:用 rusty 做快速检查

入口 `handleCheck`(`src/tools/check.ts`)。与 `plc_compile` 用的 matiec 是**两个不同的编译器**:check 走 [rusty](https://github.com/PLC-lang/rusty)(容器内的 `plc` 命令),只做 `--check`,不产出任何运行产物。

### 调用方式

`realCheckExec` 把 ST 源 `docker cp` 进容器,然后在容器里拼一条命令:

```bash
STD=$(ls /opt/iec61131-stdlib/*.st 2>/dev/null | grep -Ev "bit_conversion|string_conversion|string_functions|extra_functions")
plc --check /tmp/plc_check_input.st $STD 2>&1
```

三个实现细节都有来由:

- **附带 stdlib 声明**:`PLC_CHECK_STDLIB_DIR`(默认 `/opt/iec61131-stdlib`)下的标准函数 `.st` 声明一起传入,否则用户代码里调用 `TON`、类型转换函数等会误报未定义;
- **排除 4 个文件**:`SKIP_STDLIB = ['bit_conversion', 'string_conversion', 'string_functions', 'extra_functions']`——这几个文件会让 rusty v0.5.0 的 `--check` 直接 panic,必须从声明集中剔除;
- **`2>&1` 合并流**:rusty 的诊断走 stderr,合并后统一从 stdout 解析,退出码单独捕获。

判定规则一句话:**`ok ⇔ plc --check 退出码为 0`**。非零但解析不出任何诊断时(比如容器里根本没装 `plc`),返回 `errorMessage` 指明是基础设施问题而非代码问题——这是 `CheckResult`(`src/types.ts`)里 `errors` 与 `errorMessage` 分开的原因:前者是代码错,后者是环境错。

### 为什么裸 FUNCTION_BLOCK 可以过

rusty 按普通编译单元处理输入,不要求 `PROGRAM`/`CONFIGURATION` 骨架——所以一段只有 `FUNCTION_BLOCK ... END_FUNCTION_BLOCK` 的代码也能检查。这让 agent 可以在拼装完整程序**之前**就对单个功能块做增量检查,是 check 的核心用法。

### 与 OpenPLC 可运行性的差异

`src/server.ts` 里工具描述写得很直白:"passing does NOT mean it runs on OpenPLC"。差异来源:

| 维度 | plc_check (rusty) | plc_compile / buildAndRun (matiec) |
|---|---|---|
| 接受裸 FUNCTION_BLOCK | 是 | 否,须完整 PROGRAM + CONFIGURATION |
| 方言严格度 | 与 benchmark 评测同款编译器,过 check 即与评测口径对齐 | 有自己的怪癖(`END_IF;` 须带分号、AT 与非 AT 变量不能同块等,见 [编译与部署管线](wiki/tools/compile-pipeline) 的错误模式表) |
| 语义门 | 无 | 死输出硬门(声明的 `%Q` 必须有赋值) |
| 产物 | 无(check-only) | ZIP + variableMap,可上传运行 |

所以正确的工作流是:check 做快速迭代,最终仍要过 `plc_buildAndRun` 才算"能跑"。

### rustyErrorParser 的输出结构

rusty 输出 codespan 风格的彩色诊断。`parseRustyErrors`(`src/tools/rustyErrorParser.ts`)先 `stripAnsi` 剥掉 SGR 颜色码,再做两段匹配:`error[Exxx]: message` 头行,以及其后**至多 3 行内**的 `┌─ <file>:<line>:<col>` 定位行:

```ts
const headRe = /error\[(E\d+)\]:\s*(.+?)\s*$/
const locRe = /┌─\s*(?:.+?):(\d+):(\d+)/
```

每条产出 `RustyError { code, message, line, col }`;定位行缺失时 `line`/`col` 为 `null`(不丢错误,只丢位置)。`CheckResult.raw` 保留完整的去色输出,供 agent 在结构化字段不够时兜底阅读。

## plc_detectIO:离线 IO 扫描

`detectIO`(`src/tools/detectIO.ts`)纯函数、零依赖——不启动编译器、不碰 Docker,直接正则扫描 ST 源码里的 `AT` 定位声明:

```ts
const AT_DECL_RE = /(\w+)\s+AT\s+(%[IQM][XBWDL]\d[\d.]*)\s*(?::\s*([A-Za-z_]\w*))?/gi
```

设计依据:`AT` 声明就是定位 IO 的**权威事实源**——matiec 的 `LOCATED_VARIABLES.h` 本身就是从它派生的,离线扫描与编译产物必然一致。同名声明首次出现获胜,保持源码顺序。

每个条目推断出:

| 字段 | 规则 |
|---|---|
| `direction` | 地址第二个字符:`I` → `input`,`Q` → `output`,`M` → `memory` |
| `type` | 声明里 `: TYPE` 部分,缺省为 `''` |
| `modbusType` / `modbusAddr` | 按 OpenPLC 映射规则(下表);无对应者为 `null`,**条目仍保留**——调用方能看到完整 IO 面,只是没有 Modbus 通道 |

### OpenPLC Modbus 地址映射

`mapModbus` 实现的规则(源码注释标注 OpenPLC §10.3):

| IEC 地址类 | Modbus 类型 | 地址计算 | 例 |
|---|---|---|---|
| `%IX<byte>.<bit>` | `discrete_input` | `byte * 8 + bit` | `%IX0.3` → 3,`%IX1.0` → 8 |
| `%QX<byte>.<bit>` | `coil` | `byte * 8 + bit` | `%QX0.0` → 0 |
| `%IW<n>` | `input_register` | `n` | `%IW2` → 2 |
| `%QW<n>` | `holding_register` | `n` | `%QW0` → 0 |
| `%M*`、`%IB/%QB`、`%ID/%QD` 等 | `null` | — | 内存区与字节/双字形式无 Modbus 等价物 |

位类地址的 `byte*8+bit` 折算是 OpenPLC 的缓冲区布局约定:每个字节地址占 8 个连续的 bit 位,`%IX1.0` 从第 8 位开始。

### 死输出检测(与 compile 的语义门共用)

同文件的 `findUnassignedOutputs` 在 `detectIO` 结果上做过滤:`direction === 'output'` 且程序体(先 `stripStComments` 剥注释,防止注释里的 `:=` 误判)中找不到 `\b<名>\b\s*:=` 的名字即为死输出。`plc_compile` 用它做编译前硬门——细节见 [编译与部署管线](wiki/tools/compile-pipeline)。

### io_map.yaml 提示层

`src/tools/ioMap.ts` 提供一个可选的语义提示层:项目里的 `io_map.yaml` 按 ST 符号名给出 `component` / `label`,`applyIoMap` 把 `component` 填进 `DetectedIO`。设了 `component` 时,它在部件选择(`suggestScene` / `buildSimulation` 的仿真出图)中**优先于变量名启发式**。`parseIoMap` 完全容错:空文件、非法 YAML、非对象结构一律返回 `{}`——提示层是可选的,永不致命。

## genModbusConfig:modbus_slave 插件配置

`buildModbusSlaveConfig`(`src/tools/modbusConfig.ts`)把 `detectIO` 的结果转成 OpenPLC modbus_slave 插件的配置(schema 与运行时 `simple_modbus.py` 实际消费的字段对齐):

```json
{
  "network_configuration": { "host": "0.0.0.0", "port": 502 },
  "buffer_mapping": {
    "coils":             { "qx_bits": 8 },
    "discrete_inputs":   { "ix_bits": 4 },
    "holding_registers": { "qw_count": 2 },
    "input_registers":   { "iw_count": 1 }
  }
}
```

各块大小由 `sizeFor` 计算:该 Modbus 类型下**最大地址 + 1**(恰好覆盖所有检测到的地址),没有条目则为 0;无 Modbus 映射的条目(`%M*` 等)不参与。这样生成的从站不会暴露多余的地址空间。

两条使用路径:

1. **CLI 手动生成**:`node dist/cli.js genModbusConfig program.st [--host] [--port]`(见 [独立 CLI](wiki/tools/cli)),输出 JSON 自行部署;
2. **编译时自动注入**:设置 `PLC_MODBUS_PORT` 后,`handleCompile` 在编译成功后把配置以 `conf/modbus_slave.json` 追加进程序 ZIP(`src/tools/compile.ts` 的 `realInjectModbusConf`,在容器内 `zip -q` 追加)。OpenPLC 上传时的插件规则是"`conf/` 下有同名 json 的插件才启用",所以这一个文件就让上传即自动开启 Modbus TCP 从站——FUXA 等 SCADA 可直接读运行程序的 `%QX/%QW`。默认关闭(不设环境变量就不注入)。
