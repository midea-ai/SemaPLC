---
name: plc-build-and-verify
description: 把 ST 代码完整跑通并验证行为：写 .st 到 src/programs/ + 写 plan.json(依据需求设计 1-3 个代表性工况) + 运行 verify 命令，读 stdout JSON 信封下结论；失败按 failure.stage 分诊(compile→修 ST 重跑、caseSetup→查驱动勿改程序、assert→看 hints/lastFrames)
---

# 构建并验证 PLC 程序(verify runner 配方)

## 起手先看模式库(省一半迭代)

复杂控制逻辑从零手写容易反复栽(移位寄存器 off-by-one、状态机相位边界、PID 缺 plant)。**本 skill 目录下** `st-patterns/` 有**已验证编译通过的可改写骨架**(路径相对本 skill 的 base path),遇到对应拓扑**先 `view_file` 对应模板,改名字/数量/阈值**,别从零写:
- `./st-patterns/latch_priority.st` — 输入驱动锁存 + 优先级覆盖(电机启停/阀门启停)。一行 RS 锁存,急停天然最高优先。
- `./st-patterns/edge_counter.st` — R_TRIG 边沿计数 + 下限钳位 + 阈值比较输出(停车场/产线计数/批次)。
- `./st-patterns/bangbang_plant.st` — 双位(bang-bang)回差控制 + 自驱 plant(水箱液位/温控开关)。
- `./st-patterns/state_machine_timed.st` — N 状态机 + TON 定时器(红绿灯/顺序动作)。自驱循环。
- `./st-patterns/pid_level_with_plant.st` — 连续量闭环 + **内部 plant 自驱**(液位/温度/PID)。**反馈量必须是程序自驱的内部量/输出,不能是 %IW 输入**(否则 buildSimulation 的 plant 硬门会拒、实时仿真死图)。
- `./st-patterns/conveyor_shift_register.st` — 传送带工件追踪 + 移位寄存器分拣(最难)。工件位置自驱量 + 验持久后果。

## 骨架:两个数据文件 + 一条固定命令

1. `write_file` 写 ST → `src/programs/<名>.st`(含 PROGRAM + CONFIGURATION)。
2. `write_file` 写 `plan.json` → 工作区根(完整契约与示例:`view_file` 本 skill 目录的 `./plan-schema.md`)。
3. `run_shell` 执行(运行目录=工作区根;**不要传 timeout**,runner 自我限时 100s):

   ```
   node __PLC_TOOLS_CLI__ verify plan.json
   ```

三个调用没有前后依赖,**建议一轮发齐**。结论只从 stdout 的 JSON 信封读。

不要找单独的编译/force/trace/waitFor 工具——它们在本环境不可用,所有"编译/运行/驱动/断言"都在这一条命令里。

## 写 plan 前 5 行自查(逐条过,有不过就先改 ST 草稿)

1. **提取契约**:从需求散文列出全部输入/输出/分支/阈值——plan 的工况只依据这份散文设计,**不要去找/猜隐藏的测试断言**。
2. **覆盖性**:每个输入都被逻辑用到?每个声明的 `%Q` 输出都有赋值驱动来源?(死输出编译能过、运行恒初值,verify 的 changed 断言才暴露。)
3. **边界**:每个阈值定清 `<` 还是 `<=`、相等归哪侧;负数/0/上界各落哪个分支;`CASE` 都有 `ELSE`。
4. **互斥/优先级**:急停/停止类信号最先判断、压倒后续;互斥输出真的互斥。
5. **周期语义**:该跨周期记忆的(计数/锁存/状态机)有正确复位条件;该每周期重算的在程序体开头显式赋初值。

(复杂需求——多互斥条件/长状态机——仍可完整走 `plc-spec-review` skill 的 8 条清单。)

## 怎么填 plan(工况设计纪律)

- **只依据需求散文设计 1–3 个代表性工况**,别穷举。典型组合:一个正常路径 steady + 一个边界/互斥 case + (有时序时)一个 trace/sequence。
- **输入驱动型程序必须在 `set` 里驱动输入**:仿真环境 `%IX`/`%IW` 恒 0,不驱动就停在空闲态,什么都验不出。"没驱动过输入的 verify" = 未验证。
- **force 类型口径**:`%I` 输入/`%Q` 输出的 BOOL/INT/UINT/REAL 实测均可 force——模拟量设定值直接在 `set` 里写数字。FB 内部变量不能进 `set`,但可作 `when.var` 观察、可在 `expect`/`expectShape` 断言。
- **移位寄存器/传送带传播:验持久后果,不追脉冲穿行。** 单脉冲在寄存器里几个周期就移走了,任何采样都追不上。用 `steady` + `pulseScans` 投一个干净脉冲,断言它**留下的持久后果**(计数 +1、推杆锁存);别设计"逐格追那个 bit"的工况。
- **时序看形状,不数精确值**:状态机轮转/闪烁用 `trace` + `{"kind": "cycle"}`;推进/计数用 `changed`;不要断言"N 秒后计数正好 = X"。
- **连续量/位置量输出必须加一条 `changed`** 防死值(全程不动 = 无自驱或程序未消费输入)。
- **状态依赖的 case 加 `"resetBefore": true`**(计数器/锁存/状态机),避免前序 case 污染。
- **异常路径(推荐)**:急停/互锁(运行中置急停→断言输出归零)、超时故障、模拟量边界值(0/满量程/刚过阈值),各一个 case 即可。
- **预算**:总 100s 硬上限、每 case 默认 30s。超预算会被静态预检拦下(`stage=plan` 附拆分指引:第一个 plan `"stopAfter": false`,第二个 `"skipBuild": true`)。

## 失败分支表(failure.stage → 处置)

**完整失败分支表是 AGENTS.md 的常驻路由(每轮都在上下文里),不在此重复**——按信封的 `failure.stage` 对照 AGENTS.md 的《失败分支表》处置。本 skill 只补两条与"写 plan/设计工况"强相关的细节:

- `assert`:先看 `failure.stateTrace`(全量变量变化轨迹)+ `hints` + `lastFrames` 分诊**工况错(改 plan)vs 程序错(改 .st)**;改了 `.st` 全部 case 重跑。
- `caseSetup`:**前置工况未成立**(force 失败/when 未触发/脉冲未被扫描/变量名未解析)→ 查 plan 的驱动与变量名、时序,**勿改程序**(程序对不对还没测到)。

## 验证结论与 ST 版本绑定(必读)

**每一条结论只对信封 `stHash` 对应的那一版 ST 成立。** 中途改了 `.st`(逻辑/AT 变量/地址平移),此前信封作废——重跑同一条 verify 命令,全部 case 在新版本上重新成立才算通过。**交付引用的必须是最后一次 `ok:true` 信封的 `stHash`**,不得把旧版本的结论搬进总结。

## 交付措辞

- **引用信封原文**:`summary` 一句话结论 + `stHash` 版本指纹,不要自由复述/夸大("全部通过"必须是信封 `ok:true` 说的,不是你说的)。
- 部分工况受预算限制没跑:如实标注"行为验证部分完成(信封 X/Y case)",存疑点交用户判断。

## 验证预算与"必出图优先"(治"死磕验证交不出仿真")

- **行为验证是"尽力而为 + 上限",不是"必须穷尽"**:同一程序的 verify 重跑**最多约 3 轮**(plan 错 2 次封顶、compile 3 轮封顶、assert 分诊后改动 ≤2 轮);到顶就接受当前已编译通过的版本,如实标注后**立刻进入 `plc-build-simulation` 出图**。
- **里程碑优先级:编译通过(信封 steps 的 buildAndRun ✓)→ `plc_buildSimulation ok:true`(出图)→ 才是穷尽行为验证。** 注意 buildSimulation 的版本门要求当前 `.st` 有一次 **`ok:true`** 的 verify 信封:到预算上限仍过不了时,把过不去的 case 从 plan 移除、留能通过的最小断言集(至少编译 + 一条 changed/基础 steady)重跑拿到 `ok:true` 再出图,并在结论里如实标注哪些工况未验证;**不要擅自传 `allowUnverified:true`**(仅限用户明确要求)。
- 一次 `caseSetup`/采样对不上,先怀疑工况设计(本表分诊),**不要反复重写控制逻辑**。
