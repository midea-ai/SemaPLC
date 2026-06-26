# plan.json 完整契约(verify runner)

本文是 `plan.json` 的唯一权威契约。所有 JSON 示例都是**可直接照抄的纯 JSON**——无注释、无尾逗号。

## 固定命令(只有这一条)

```
node __PLC_TOOLS_CLI__ verify plan.json
```

- **运行目录 = workspace 根**(plan 里的 `program` 路径、`artifacts.runDir` 都相对它解析)。
- **不要给 run_shell 传 timeout**——runner 自我限时(总预算 100s,见《预算》)。
- stdout 输出一个 JSON 信封,结论只从信封读(见《信封读法》)。

## 顶层结构

```json
{
  "program": "src/programs/motor_latch.st",
  "options": {
    "perCaseBudgetMs": 30000,
    "stopAfter": true,
    "failFast": false,
    "skipBuild": false
  },
  "cases": [
    {
      "name": "按下启动后电机锁存",
      "type": "steady",
      "set": { "start_btn": true },
      "settleMs": 500,
      "expect": [
        { "var": "motor", "op": "==", "value": true }
      ]
    }
  ]
}
```

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `program` | 必填 | string | 工作区相对路径,必须以 `.st` 结尾(单文件,含 PROGRAM + CONFIGURATION) |
| `options` | 可选 | object | 四字段见下表,可整个省略(全用默认) |
| `cases` | 必填 | array | 非空;1–3 个代表性工况 |

### options 四字段

| 字段 | 类型 | 默认 | 何时改 |
|---|---|---|---|
| `perCaseBudgetMs` | number | 30000 | 单个 case 时序确实很长(长 trace / 多步 sequence)时调大;总预算 100s 不变,调大单 case 就要减 case 数 |
| `stopAfter` | boolean | true | 跑完是否停 PLC。**拆分成两个 plan 时第一个设 false**,让第二个 plan 用 `skipBuild` 复用运行中的程序 |
| `failFast` | boolean | false | true = 第一个失败 case 即停。工况彼此独立、想省时间时用 |
| `skipBuild` | boolean | false | true = 不编译,校验 runtime 程序与 `.st` 一致后直接复用(不一致报 `version-conflict`)。仅当程序已在运行且 `.st` 未改时用 |

### case 公共字段

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 必填 | string | 工况名(出现在信封里) |
| `type` | 必填 | string | `steady` / `trace` / `record` / `sequence` |
| `resetBefore` | 可选 | boolean | true = 该 case 开跑前重启 PLC,清掉前序 case 留下的内部状态。**状态依赖的 case(计数器/锁存/状态机)建议加** |

## 四种 case 类型

### 1. steady — force 输入 → 等稳态 → 断言末态

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `set` | 必填 | object | 要 force 的输入(变量名→值)。**只能是定位变量**(`AT %…`);`%I` 输入/`%Q` 输出的 BOOL/INT/UINT/REAL 实测均可 force,模拟量直接写数字 |
| `expect` | 必填 | array | 断言列表,每条 `{var, op, value}`;`op` 取 `==`/`!=`/`>`/`>=`/`<`/`<=`;`var` 可以是内部变量(含 FB 端口如 `timer1.q`,全小写) |
| `settleMs` | 可选 | number | force 后等多少 ms 再断言 |
| `pulseScans` | 可选 | int 1–50 | 把 `set` 变成只持续 N 个扫描周期的脉冲(自动产生干净的上升+下降沿),验 R_TRIG/边沿计数用 |
| `when` | 可选 | object | `{var, op, value, timeoutMs?}`——等该条件成立的瞬间才施加 `set`(条件触发)。**`when.var` 可以是内部变量**(如自驱位置量) |

steady 基本型:

```json
{
  "name": "空闲态电机应停",
  "type": "steady",
  "set": { "start_btn": false, "stop_btn": false },
  "settleMs": 500,
  "expect": [
    { "var": "motor", "op": "==", "value": false }
  ]
}
```

steady + pulseScans(R_TRIG 边沿计数:一个脉冲 = 计数 +1):

```json
{
  "name": "到位传感器脉冲一次计数加一",
  "type": "steady",
  "resetBefore": true,
  "set": { "part_sensor": true },
  "pulseScans": 2,
  "settleMs": 300,
  "expect": [
    { "var": "part_count", "op": "==", "value": 1 }
  ]
}
```

steady + when(条件触发:工件位置到 20 的瞬间按下传感器):

```json
{
  "name": "工件到检测位时触发分拣",
  "type": "steady",
  "set": { "detect_sensor": true },
  "when": { "var": "belt_pos", "op": ">=", "value": 20, "timeoutMs": 8000 },
  "pulseScans": 2,
  "settleMs": 300,
  "expect": [
    { "var": "pusher", "op": "==", "value": true }
  ]
}
```

> 条件快变时 `when.op` 优先用 `>=`/`<=` 区间,别用 `==` 精确值(可能跨扫描跳过)。

### 2. trace — 按时间采样 → 断形状

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `vars` | 必填 | string[] | 要采样的变量(非空) |
| `durationMs` | 必填 | number >0 | 采样总时长。采样地板 ~50ms/样本,常规 3000–6000ms(15–30 帧)足够看形状 |
| `intervalMs` | 可选 | number | 采样间隔;低于 ~50ms 物理地板时按地板执行 |
| `set` | 可选 | object | trace 期间持有的输入(结束自动释放) |
| `expectShape` | 必填 | array | 形状断言,见《expectShape 四种 kind》 |

trace + cycle(交通灯轮转):

```json
{
  "name": "三灯按红绿黄轮转",
  "type": "trace",
  "vars": ["state"],
  "durationMs": 6000,
  "intervalMs": 200,
  "expectShape": [
    { "var": "state", "kind": "cycle", "sequence": [0, 1, 2] }
  ]
}
```

### 3. record — 逐扫描录波(变化转折点) → 断形状

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `vars` | 必填 | string[] | 要录的变量(非空) |
| `lastScans` | 可选 | 正整数 | 只取最近 N 个扫描 |
| `fromTick` | 可选 | 正整数 | 从某 tick 起取 |
| `expectShape` | 必填 | array | 同 trace |

> 注意:`settle` 形状在 record 路径按**变化次数序列**取末段而非时间窗,高频振荡后收敛的信号慎用(用 trace+settle 代替)。

record + changed(自驱位置量在动,防死值):

```json
{
  "name": "工件位置量自驱推进",
  "type": "record",
  "vars": ["belt_pos"],
  "lastScans": 200,
  "expectShape": [
    { "var": "belt_pos", "kind": "changed" }
  ]
}
```

### 4. sequence — 多步时序(按下→松开→再按)

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `steps` | 必填 | array | 非空;每步至少含 `set`/`waitFor`/`expect` 之一 |

每步字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `set` | object | 本步 force 的输入(持续生效到被后续步覆盖或 case 结束) |
| `pulseScans` | int 1–50 | 本步 `set` 改为 N 扫描脉冲 |
| `settleMs` | number | 本步动作后等待 ms |
| `waitFor` | object | `{var, op, value, timeoutMs?}`——轮询直到条件成立(代替猜 sleep) |
| `expect` | array | 本步断言,每条 `{var, op, value}` |

sequence(启动→确认运行→急停→确认全停):

```json
{
  "name": "运行中急停应立即停机",
  "type": "sequence",
  "resetBefore": true,
  "steps": [
    {
      "set": { "start_btn": true },
      "waitFor": { "var": "motor", "op": "==", "value": true, "timeoutMs": 3000 }
    },
    {
      "set": { "start_btn": false, "estop": true },
      "settleMs": 300,
      "expect": [
        { "var": "motor", "op": "==", "value": false },
        { "var": "alarm_led", "op": "==", "value": true }
      ]
    }
  ]
}
```

## expectShape 四种 kind

| kind | 必带字段 | 语义 |
|---|---|---|
| `cycle` | `sequence`(≥2 元素,**元素必须互不重复**) | 折叠连续重复后,每个相邻转移必须是 `sequence` 里的"下一个"(循环);**入口可在环中任意点**;至少要观测到 2 次转移才算轮转 |
| `range` | `min` + `max`(都必填,number) | 全程每个样本都在 `[min, max]` 内 |
| `settle` | `min` + `max`(必填);`tailRatio` 可选,默认 0.25 | 末段(最后 tailRatio 比例的样本)都在 `[min, max]` 内——PID 收敛类用 |
| `changed` | 无参 | 样本中至少出现 2 个不同取值。**连续量/位置量输出必须加一条 changed 防死值**(全程不动 = 无自驱或程序未消费输入,这是高频翻车点) |

## 宽容性(写错也能救,但别依赖)

- **字符串数字/布尔会自动转真类型**:`"99"`→99、`"true"`→true。但请直接写 `99` / `true`。
- **旧式 `"expectations": {"x_min": 5}` map 形会自动转换**(`_min`→`>=`、`_max`→`<=`、其余→`==`),**不要再用**——新 plan 一律写 `expect` 数组。
- **JSON 里的注释与尾逗号会被剥掉再 parse,但不要写**——本文所有示例都是纯 JSON,照抄即可。
- 未知字段会报错并附"是不是想写 X?"建议——按建议改,别自创字段。

## 高频写错(❌ → ✅,这几个占了 plan 校验失败的大头)

**① `set` 不能是空对象**——steady/sequence 步的 `set` 是要 force 的输入,必须有内容;没有要驱动的输入,这个 case 本就不该用 steady。
```
❌ "set": {}          → 报 "set 不能为空对象"
✅ "set": { "start_btn": true }
```

**② sequence 步里只有 `set`/`waitFor`/`expect` 三个动作字段,别把 `expect` 当顶层 case 字段塞进 trace**——`expect` 只在 steady 和 sequence 的 step 里;trace/record 用 `expectShape`。
```
❌ { "type": "trace", "vars": ["s"], "durationMs": 6000, "expect": [...] }   → "未知字段 expect"
✅ { "type": "trace", "vars": ["s"], "durationMs": 6000, "expectShape": [{ "var": "s", "kind": "cycle", "sequence": [0,1,2] }] }
```

**③ sequence 步的 `waitFor` 是一个对象,不是数组**(它等单个条件成立);`expect` 才是数组(可断言多条)。
```
❌ "steps": [ { "set": {...}, "waitFor": [{ "var": "running", "op": "==", "value": true }] } ]   → "expect 条目必须是对象"
✅ "steps": [ { "set": {...}, "waitFor": { "var": "running", "op": "==", "value": true, "timeoutMs": 3000 } } ]
```

## 信封读法

stdout 的 JSON 信封字段:

| 字段 | 含义 |
|---|---|
| `ok` | true = 全部通过 |
| `summary` | 一句话结论(交付时直接引用,别自由复述) |
| `stHash` | 本次验证绑定的 `.st` 内容指纹(交付时一并引用,证明结论对应当前版本) |
| `steps` | 各阶段名/成败/耗时 |
| `failure.stage` | 失败阶段(10 个取值,见下表) |
| `failure.detail` / `failure.hints` / `failure.lastFrames` | 细节 / 自动分诊提示 / 失败前断言量最后几帧 |
| `failure.stateTrace` | **assert 失败时全量变量的变化轨迹**(如 `state: 0→1 \| color_latched: F→T \| [断言失败] pusher: F(全程未变)`)——看内部状态怎么走的,定位"输出为什么错" |
| `cleanup` | force 释放与停机情况(runner 自动清理,不用你 release) |
| `artifacts.runDir` | 全量工件目录(`.plc-act/runs/<时间戳>/`,含 envelope.json / plan 副本 / program 快照) |

### failure.stage 10 个取值

| stage | 含义 |
|---|---|
| `plan` | plan.json 校验/静态预检失败(detail.errors 带 path + suggestion) |
| `compile` | iec2c 编译失败(detail 即 iec2c 结果,errors[] 带 line/sourceLine/advice) |
| `gcc` | GCC/upload 部署失败 |
| `start` | PLC 启动失败 |
| `runtime` | runtime 不可达(容器没起) |
| `caseSetup` | **前置工况未成立**(见下,勿改程序) |
| `assert` | 驱动成立但断言失败(见下,先分诊) |
| `version-conflict` | skipBuild 时 runtime 程序与 `.st` 不一致 |
| `timeout` | 总预算耗尽 |
| `exception` | runner 内部异常 |

### caseSetup ≠ assert(最重要的分界)

- **`caseSetup` = 前置工况没立起来**:force 施加失败 / `when` 条件超时未触发 / 脉冲未被扫描到(PLC 没在跑)/ 变量名未解析。这是**驱动侧**问题——查 `set`/`when` 的变量名(看 detail 里的 nameSuggestion)、时序、PLC 是否在跑。**勿改程序**:程序对不对根本还没测到。
- **`assert` = 驱动成立但断言失败**。**先看 `failure.stateTrace`**——它给出失败窗口内所有变量怎么变的(内部状态机/计数器/标志),直接告诉你"输出为什么错":若内部状态有响应但输出没跟上,是**下游逻辑/时序/传播延迟**问题(别去查变量名);若全程没任何变量动,才是输入没被消费/变量名错。再结合 `failure.hints` 与 `failure.lastFrames` 分诊是**程序错**(逻辑没实现对→改 `.st`)还是**工况错**(plan 期望写错/阈值搞反→改 plan.json)。改了 `.st` 就要重跑全部 case(旧结论作废)。

## 预算

- **总预算 100s 硬上限**(runner 自我限时并留清理余量,所以 run_shell 不要传 timeout)。
- 每 case 默认 30s(`perCaseBudgetMs`)。
- **超预算会被静态预检直接拦下**:不跑,报 `stage=plan`,message 附拆分指引——拆成两个 plan 分两次 verify:第一个 plan 含前半 cases 且 `"stopAfter": false`;第二个含其余 cases 且 `"skipBuild": true`(复用已在运行的程序,免重复编译)。

## 止损条款(防越改越烂)

- 命令报 `command not found` / stdout 里没有 JSON 信封 → **报告用户,不要自行 npm install、装包、改环境**。
- 同一个 `stage=plan` 错误连续 2 次没消掉 → 停手,把 plan.json 与 errors 原文报告用户。
- 信封缺失但命令似乎跑过(进程被杀等)→ artifacts 可能已落盘,读 `.plc-act/runs/` 下最新目录的 `envelope.json`。
