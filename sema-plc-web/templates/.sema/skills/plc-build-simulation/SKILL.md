---
name: plc-build-simulation
description: 程序跑起来后构建会动的过程仿真——detectIO 取 IO，按物理语义从部件库选件并配置点位（库里没有的现画 custom SVG），用 plc_buildSimulation 校验生成，前端按运行值实时动画
---

# 构建过程仿真

> **前置:当前 `.st` 必须已通过 verify**(`node __PLC_TOOLS_CLI__ verify plan.json` 信封 `ok:true`)。`plc_buildSimulation` 带版本门——未验证或改过 `.st` 没重验都会被拒,正确做法是先跑 verify,**不是**传 `allowUnverified:true`(该旁路仅限用户明确要求跳过验证时)。

程序经 verify 跑通后，为它生成一张随运行值动起来的过程画面。

## 部件库（库打底）

<!-- SYNC-GUARD: 此 kind 列表必须与 plc-vis-web/src/components/sim/partsCatalog.ts 及
     plc-tools/src/tools/partsCatalog.ts 的 PART_KINDS 一致。改部件库时三处同步,
     由 plc-tools tests/tools/catalogSync.test.ts 守门(测试红即漂移)。
     bullet 格式必须为:- `kind` — 描述   其中 — 是 U+2014 em dash(从上方已有 bullet 复制,
     勿用普通连字符 -,否则正则静默漏匹配,catalogSync 报数目不符)。 -->

每个部件有一个主锚点（随值变化的元素）+ 适配的效果：

- `lamp` — 指示灯，按值变色（灭/亮）。值类型 BOOL；效果 fill/visible
- `sensor-button` — 传感器/按钮状态指示。BOOL；fill
- `valve` — 阀，开/关变色。BOOL；fill/class
- `cylinder` — 气缸活塞，伸出/缩回。BOOL；fill/translateX/visible
- `motor` — 马达，运行时旋转。BOOL；class(sim-run)/rotate/fill
- `conveyor` — 传送带，运行时皮带滚动。BOOL；class(sim-run)
- `tank` — 罐/液位，按值升降。INT/REAL；height/fill
- `numeric-display` — 数码显示。INT/REAL；text
- `gauge` — 指针表，指针随值旋转。INT/REAL；rotate（needle 已绕表盘圆心，直接 rotate 即可）
- `pump` — 泵，运行时叶轮旋转。BOOL；class(sim-run)/fill
- `hopper` — 料斗，按值升降料位。INT/REAL；height/fill
- `stack-light` — 报警灯柱，红/黄/绿三段。BOOL；每段一条 fill binding（多 binding 件，见下文示例）
- `slider` — 模拟量输入滑块，运行时可拖动设定数值。INT/REAL；primary 绑 translateX(valueFrom/to=min/max, from=0/to=126) 反映实时值、val 绑 text 显数值；绑可 force 的数值量（%IW/%QW），拖动经 plc:force 写值；params:{min,max,step}

## 效果（Effect）速查

- `fill`: `{type:'fill', map:[{when, color}]}` — 离散按值着色
- `visible`: `{type:'visible', when}` — 显隐
- `text`: `{type:'text', format?, decimals?, suffix?}` — 值渲染为文字，`{v}` 占位；`decimals` 控制小数位（如 `decimals:1` → "72.5"），`suffix` 追加单位（如 `suffix:" °C"` → "72.5 °C"）
- `translateX`/`translateY`: **推荐绝对写法** `{type:'translateY', valueFrom, valueTo, yFrom, yTo}` — `yFrom/yTo` = 目标元素(bbox 顶边)要到达的**绝对 y**(viewBox 单位,照图上坐标直接写),工具自动换算;`translateX` 用 `xFrom/xTo`(左边绝对 x)。高级/遗留:相对位移 `from/to`(叠加在绘制位置上,极易把绝对坐标误当相对——**勿与绝对字段混写**)
- `width`/`height`/`opacity`: `{type, valueFrom, valueTo, from, to}` — 值线性映射(`opacity` 映射 0~1)
- `rotate`: `{type:'rotate', degPerUnit?}`
- `class`: `{type:'class', map:[{when, className}]}` — 切 CSS（传送带/马达用 `sim-run`）

`when`（ValueMatch）：`{eq:0|1|true|false}` | `{gte, lt?}` | `{truthy:true}`

## 最小合法 scene（精确字段名 — 组装前先照这个）

下面是**可直接传给 `plc_buildSimulation` 的最小合法 scene**。照着改 variable / kind / 坐标即可:

```json
{
  "version": "1",
  "canvas": { "width": 800, "height": 450 },
  "parts": [
    {
      "id": "block",
      "kind": "custom",
      "x": 100,
      "y": 200,
      "svg": "<svg viewBox=\"0 0 40 40\"><rect id=\"box\" width=\"40\" height=\"40\" fill=\"#3b82f6\"/></svg>",
      "bindings": [
        { "variable": "wp_pos", "effect": { "type": "translateX", "valueFrom": 0, "valueTo": 660, "xFrom": 0, "xTo": 300 } }
      ]
    }
  ]
}
```

字段就这些,**别自创** `position`/`anchor`/`prop`/`value` 这类字段。两类最常踩的畸形(工具会兜底归一化,但请直接传对):
- **数字字段传 number 不加引号**:`canvas.width`/`height`、`x`/`y`、effect 的 `valueFrom`/`valueTo`/`xFrom`/`xTo` 都写 `800` 不是 `"800"`。(遗留相对写法 from/to 同理)
- **`parts` 是数组**:直接 `"parts": [ ... ]`,不要写成 `"parts": { "item": [ ... ] }`。

## 前置(GATE)

**本程序必须已通过 verify 再建仿真**(版本门机器强制,见顶部前置)。若尚未验证,先回 plc-build-and-verify 写 plan 跑 verify——别在没验证过行为的程序上建仿真,否则绑定多半是猜的。

> **硬规则(唯一正道,违反=死图):**
> 1. **`config/scene.json` 只能由 `plc_buildSimulation` 写**。**严禁用 `write_file`/`patch_file` 直写 `config/scene.json` 绕过校验**——直写的坏 scene 会被前端静默渲染成"死图"(绑定不生效、灯不亮、不可点),且读时校验会在画面顶部红框报错。
> 2. **`plc_buildSimulation` 返回 `ok:false` ⇒ scene 未写盘,任务未完成**。必须按 `errors[]` 改 scene **重试到 `ok:true`** 才算交付;**绝不能在 `ok:false` 时宣称"仿真已生成/完成"**。反复失败时退回《逃生条款》的库部件 dashboard(它也走 `plc_buildSimulation`、也要 `ok:true`),而不是直写绕过。
> 3. **binding 的 `effect` 必须是对象** `{type, ...}`(如 `{type:'fill', map:[...]}`、`{type:'visible', when:{...}}`),**不是裸字符串** `"fill"`,**也不要用顶层 `effects:[{var,expr,...}]`**——本系统不支持 `expr` 任意表达式,只认 `bindings:[{variable, target?, effect}]`。

## 连续运动/液位:在写 ST 阶段就建自驱量(仅限传送带工件位移、液位等真正连续过程量)

**若需求含连续运动/液位演示:在 ST 里加一个自驱位置/液位量(`%QW` INT 输出),而不是到仿真阶段才补。** 让它每扫描周期自增或按进/出积分:

- 工件位置:`pos := pos + k`,到量程回环(如 `IF pos >= 660 THEN pos := 0; END_IF;`)。
- 液位:进水 `level := level + k`、溢流饱和(如 `IF level > 1000 THEN level := 1000; END_IF;`)。

仿真用这个连续量驱动 `translateX`(工件)或 `height`(液位)。**不要用 BOOL 运行量或 `visible` 假装连续量**(阀开 ≠ 满,运行量只有 0/1 两态会跳变)。注意区分两类连续量:**随时间自动演化的过程量(液位、工件位置)** 应是**程序自驱的输出**(由内部动态自增/饱和),仿真只读它做动画;而**设定值/外部模拟量输入(`%IW`)是可以 force 的**(runtime 与 `isForceable` 均已支持 INT/UINT/REAL 等所有已定位类型的输入),需要外部注入时正常 force 即可。

> **plant 自驱硬门(buildSimulation 会拒)**:用运动效果(`translateX`/`height`/`rotate`)绑一个**定位输入量 `%IW`/`%IX`** 且**没给它绑 slider/sensor-button 控件** → 被拒。因为程序写不了输入量,实时仿真里它恒为初值=死图(PID 把液位反馈当 `%IW` 读、缺闭环 plant 是高频坑)。两条出路:① **把它做成程序自驱的内部量/输出**(`level := level + k*valve_out` 这种 plant 模型),仿真绑那个自驱量;② 若本就该用户手动给,**绑一个 slider(模拟量)或 sensor-button(开关)**让用户驱动。

**气缸伸缩、阀门开关、电机启停等离散动作不需要自驱量**——它们的输入（限位开关、启动按钮）就是需要用户手动 toggle 的，这符合交互式演示的定位。判断标准是**动画是否需要连续位置插值**：电梯轿厢需要楼层间平滑移动，属连续过程量，需要自驱量；而到位限位开关是离散输入，不需要。

> **关键例外——"自动循环演示"需要派生传感器(治"序列卡死/不振荡"):** 若需求是**自动按节拍循环往复**(气缸 A伸→缩→B伸→缩、水箱液位上下振荡、电梯自动跑层),而你的控制逻辑**门控在 `%IX`/`%IW` 传感器输入上**(限位开关 `A_LS_plus`、液位开关 `lls`/`hls`、楼层到位 `floor_2`),那么**仿真里没有物理模型驱动这些输入、ST 也写不了输入** ⇒ 它们恒为 0/初值 ⇒ **序列永远卡在第一步 / 阀永不切换 / 液位顶满不振荡**。解法:**在 ST 里建自驱过程量(`%QW`)并从它派生一个内部到位布尔,让顺序逻辑门控在派生布尔上**,`%IX` 传感器仅作显示/可选手动覆盖:
> ```
> piston_pos := piston_pos + step;  IF piston_pos >= MAX THEN piston_pos := MAX; END_IF;  (* 自驱 *)
> a_at_plus := piston_pos >= MAX;   (* 内部派生到位,非 %IX 输入 *)
> (* 顺序逻辑门控在 a_at_plus 而不是裸 A_LS_plus 输入 *)
> ```
> 同理水箱 bang-bang 应**直接门控在自驱 `level` 上**(`IF level<=lo THEN v1:=TRUE; ELSIF level>=hi THEN v1:=FALSE`),把 `lls`/`hls` 当 `level` 的派生显示,而不是门控在无人驱动的 `%IX` 开关上。**判据:这个传感器输入在仿真运行时有没有东西驱动它?没有(纯 %IX/%IW 且无 force)且需求要自动演示 ⇒ 必须改成从自驱过程量派生。** 若定位就是"手动交互演示"(用户点限位推进),才保留门控在 %IX 上并在收尾说清"点哪个推进"。

## 步骤

1. `plc_detectIO({ stCode })` 拿到当前 located IO(**生成可视化前必做,同步变量指纹**)。
2. **物理拓扑判定(必出一句,先于选件)**:根据**工艺类型 + IO 清单**推断这套设备物理上长什么样——**即便用户只给了一句话需求,也要自己补全,别等用户画布局**。你有领域知识:"传送带分拣"就隐含「带 + 工件沿带流动 + 工位传感器/推杆落在带上」;"抓放装配"就隐含「机械臂 + 取料点 + 放料点」;"水箱液位"就隐含「罐 + 进/出阀 + 液面」。明确写出:**主轴**是谁(如传送带)、**附属件**(气缸/传感器/灯)锚定在主轴的哪个工位、运动方向。然后据此判定 **custom 整图 还是散摆库部件**(判据见下文《有空间关系的场景》)——有空间关系就 custom,附属件锚定到主轴而非各摆绝对坐标。
3. **安全覆盖检查**:检查 IO 清单中是否有 `emergency_stop`、`alarm`、`fault` 类输入/输出。若有,必须在画面中绑定对应的可视化部件(如急停按钮用 `sensor-button` 可点击、报警灯用 `lamp` 或 `stack-light`)。若 IO 清单有此类安全信号但 scene 未绑定,发出警告——安全相关信号不能在仿真中"隐身"。
4. 选/配部件:**优先遵循 `config/io_map.yaml` 里的 `component`**(若已填);`plc_buildSimulation` 也会服务端合并它作兜底。**custom 整图有两个独立触发原因,满足任一即用 custom:(a) 步骤 2 判定有空间关系(即便库里有 conveyor/sensor/cylinder 这些部件也用 custom——独立图标表达不了"谁在哪、怎么动"的关系);(b) 库里没有对应的长尾部件。** "库部件优先"只管**无空间关系的仪表盘内部**怎么选件,不是"库里有就别 custom"。
5. 组装 Scene Spec：`{version:'1', canvas:{width,height}, parts:[{id, kind, x, y, label?, bindings:[{variable, target?, effect}]}]}`。**画布朝向**:仿真面板显示在**窄高的右栏**里,横版宽图会被缩成一条小横带、上下大片留白——**默认竖版或近方形 canvas(如 600×800 / 640×640),多个独立面板(控制台/设备/状态)上下竖排而非左右横排**;仅当工艺主轴天然横向(传送带产线、多工位流水线)才用横版,此时按主轴走向排。同一列内部仍是输入在上、输出在下,布局清晰即可。**画布贴合内容(同等重要)**:canvas 尺寸由实际内容算出,别先定一个大画布再把件摆在角落——每个面板高度贴合其自身内容、面板之间只留一个间距;有空间关系的附属件(旁路箱/推杆/挡板/料仓)必须紧贴主轴对应工位画,不要漂浮到远处角落。画面在面板里是整体等比缩放的,**留白越多、有效细节越小**,大片空区等于把字和按钮一起缩没。**状态机显示**：若程序含 CASE 状态机且状态变量映射到输出,建议用 `numeric-display`（text 效果）显示当前状态值。如有条件,可附加状态枚举映射注释（如 `0=IDLE, 1=RUNNING, 3=FAULT`）作为 `label`,帮助用户在画面上直读状态含义。

   **必填字段(少一个或字段名拼错都会 `ok:false`):**
   ```
   scene:   version, canvas{width,height}, parts[]
   part:    id, kind, x, y, bindings[]
   binding: variable, effect          ← 变量键就叫 variable,不是 var/name/signal;target 可选
   ```
   binding 里指向 PLC 变量的键**必须是 `variable`**——写成 `var`/`name` 是最高频的失败原因(会被判"missing variable",别拿换字段名/换路径去试,直接核对成 `variable`)。`bindings` 必须是**数组**,`effect` 必须是**对象** `{type,...}`。
6. `plc_buildSimulation({ stCode, scene })` 校验并生成。
   - **调用前自检:程序每个 BOOL `%IX` 输入,scene 里都有一条引用它的可点击绑定了吗?**(custom:`target` 与 svg `id` 大小写完全一致;库件:`sensor-button` 绑它即可。)否则 `plc_buildSimulation` 会 `ok:false` 打回。
   - 校验失败：返回 `errors[]`（如 variable 不在 IO 清单、custom target 找不到），按提示修 scene 重试。
   - 不确定怎么排时，可只传 `{ stCode }` 让它自动建议一版作为起点，再精修。
7. 前端「过程仿真」tab 会自动渲染并按 `plc:values` 实时动画。
   **本仿真是交互式演示面板，不是闭环物理仿真。** PLC 输入（%IX / %IW）不会自动变化——需要用户在画面中手动点击或拖动。不要在收尾说明中写"观察 XX 自动往复/循环"，除非 ST 中确实有不依赖外部输入的自激逻辑（如定时器交替闪烁）。
8. **收尾:用一段话告诉用户怎么验证这个仿真(必做,别只说"已生成过程仿真")。** 按本场景**实际有的可交互元素**具体写,不要套模板空话:
   - **可点的 BOOL 输入**(`sensor-button` / custom 带 id 的传感器·按钮):点一下=置 true 保持、再点=置回 false(toggle)。说清点哪个 = 触发什么(例:"点『启动』开启并保持传送带""点『到位传感器』投一个工件 → 计数 +1、推杆伸出;再点一下复位等下一个")。
   - **可拖的模拟量输入**(`slider`,绑 `%IW/%QW` 数值):拖哪个滑块 = 设什么值、预期看到什么(例:"拖『设定值』滑块调高液位目标 → 罐内液面 PID 追上去")。
   - **自动动的输出**:哪些元素随程序运行自己动(例:"红黄绿三灯按 3/1/2s 轮换""工件沿带滑动""液位随阀开度升降")。
   - 点出 **1–2 条可判对错的预期现象**(例:"按下急停后电机指示灯应立即熄灭";"绿灯 3s 到点自动切黄")。
   - 提醒前提:**程序须处于运行中**(顶栏「运行」为绿)交互才生效;模拟量也可在「变量」tab 用 Force 直接设值。

## 约定

- `binding.variable` 必须是 detectIO 列出的 located 变量名。
- BOOL 灯/阀/按钮用 `fill`（灭灰 `#9aa1ad` / 亮绿 `#22c55e`）；运行类（传送带/马达）用 `class` + `sim-run`；数值用 `text` 或 `tank` 的 `height`。
- 无空间关系的仪表盘里不必手画库部件 SVG，直接用库部件即可。但**有空间关系的场景一律 custom 整图**（即便库里有对应部件）——见《有空间关系的场景》。custom 不只是"库里没有才写"。

## io_map.yaml 提示层(可选)

`config/io_map.yaml` 可手写,给引脚标 `component`(取值同上表 8 种),在你推理前**偏置**选件。`plc_buildSimulation` 会自动合并它(返回里 `ioMapHints` 回显生效项)。最终绑定仍以你产出的 Scene Spec 为准。生成的场景写在 `config/scene.json`。程序源放 `src/programs/*.st`。

## 有空间关系的场景:用一张 custom 整图

当部件之间有**物理空间关系**(传送带产线、罐+管路、工位排布)时,**不要散摆库部件**——它们是相互独立的小图标,摆出来只是仪表盘。改为产出**一个 `kind:"custom"` 部件**,在它的 `svg` 里把整张场景画对(传送带画成一条贯穿基线,传感器/气缸**画在皮带对应工位上**,工件画成皮带上的小方块),给每个要动的元素一个 `id`,再用 `target` 分别绑值。库部件留给"几个互不相关的指示灯/数显"这类简单仪表盘。

> **默认取向:凡控制对象在物理空间里有位置/运动/工位关系的,默认 custom 整图;散摆库部件是"需论证的例外",不是兜底。** 传送带分拣 / 抓放装配 / 码垛 / 电梯 / 罐+阀+管 这类有"谁在哪、怎么动"的场景**一律 custom 整图**(电梯/停车场就是这么做对的)。**只有当你能明确论证这些 IO 之间确实没有空间关联**(红绿灯 / 几个独立指示灯 / 启停按钮+电机灯 这类纯指示/状态板)时才散摆库部件,并在收尾里说一句为什么判为无关联。
>
> **两个边界**:① 别因为"用户没描述布局"就散摆——布局该你按工艺类型自己推断(步骤 2);② 也别矫枉过正把**真无关联的指示灯板**硬画成 custom 整图、编造不存在的空间关系,那和该 custom 时散摆一样误导。判据是**控制对象物理上有没有位置/运动关系**,不是"能不能画得花哨"。
>
> **两条易漏的硬约束:**
> 1. **数值量(INT/计数/状态/液位)绝不能绑 lamp/valve 的 fill**(灯只有亮灭两态)——计数/状态用 `numeric-display`(text 效果),连续量(液位/位置)用 `tank`(height)/`gauge`(rotate)/custom 内 `translateX`。
> 2. **控制对象有连续过程量(液位/工件位置/温度)但程序里没有可视量时,主动在 ST 里加一个 `%QW` 输出量并自驱它**(如双位水箱:加 `level AT %QW0`,进水时自增、溢流饱和、出水自减),否则仿真没有可动元素、只剩开关灯。
>
> **逃生条款(避免死磕,分级降级):**
> - **SVG 解析/渲染错误**(`plc_buildSimulation` 返回结构性错误,如 SVG 畸形、字段缺失、scene 格式非法):  **立即降级**为库部件 dashboard,不重试——结构性错误靠 patch 几乎修不对。
> - **可点击门未通过**(id/交互绑定问题,如 `target` 与 svg `id` 不匹配、BOOL 输入无可点击绑定):允许 **1 次修正** target/id 后重试,仍失败则降级。
> - 降级目标:**类型正确的库部件 dashboard**(每个输入用一个 `sensor-button` 绑它——整件可点、天然过可点击门;其余 IO 按类型规则选对库件)并完成,**不要继续反复 patch ST / 改 svg 死循环**。一个类型正确、每个输入都可点的 dashboard 远胜于无限纠结、最终交不出场景。

## custom 骨架册（复制改名即用）

库里没有的长尾场景，从下面骨架复制起步。**硬约束**：
- 绑定锚点 id 必须以 `part.id` 前缀：`id="conv1_belt"`，**禁止裸 `id="belt"`**。
- `<defs>` 内 id 必须 `def-` 前缀：`id="def-grad1"` / `fill="url(#def-grad1)"`。
- **禁止 `<style>` 块**——样式走运行时 CSS class（sim-run 等），`<style>` 会泄漏到全局。
- 流动线必须自带 `stroke-dasharray="8 4"`，否则 dashoffset 动画无视觉。
- 根 `<svg>` 带 `viewBox`；坐标用比例（见坐标约定）。
- **画传送带就给工件配运动**：皮带元素 id 用含 `belt`/`conveyor` 语义的名（如 `conv1_belt`），并务必给皮带上的工件绑 `translateX`/`translateAlong` + 自驱位置量。`plc_buildSimulation` 的硬门按"画了带是否有工件移动"判定——画带却无运动 binding 会直接 `ok:false`。别用 `transporter`/`line` 等绕开关键词去回避门，那只是画出一条没有工件的死带。

### 骨架 A：传送带 + 工件联动
```svg
<svg viewBox="0 0 800 450">
  <rect x="40" y="240" width="720" height="16" rx="8" fill="#2b2f3a"/>
  <line id="line1_belt" x1="60" y1="248" x2="740" y2="248" stroke="#6b7280" stroke-width="2" stroke-dasharray="8 4"/>
  <rect id="line1_wp" data-anchor="workpiece" x="80" y="216" width="28" height="24" fill="#d2a36b" transform="translate(0,0)"/>
</svg>
```
绑定：`line1_belt` 绑运行输出（class sim-run）；`line1_wp` 用 **translateX 绝对写法**，绑一个**连续 INT 位置量**（程序自驱的 `%QW` 输出，不是 BOOL 运行量）：`valueFrom=0`、`valueTo=行程量程`（如 660）、`xFrom=80`（工件绘制起点 x）、`xTo=700`（皮带末端 x）——xFrom/xTo 是工件要**到达的绝对 x**，照上图坐标直接写，工具自动换算。绑 BOOL 运行量只会让工件在 0/1 两点跳变。

### 骨架 B：罐 + 泵 + 管路
```svg
<svg viewBox="0 0 800 450">
  <defs>
    <linearGradient id="def-tankgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect x="120" y="120" width="80" height="160" rx="6" fill="#eef0f4" stroke="#333"/>
  <rect id="tk1_level" x="124" y="0" width="72" height="0" fill="url(#def-tankgrad)" transform="translate(0,280) scale(1,-1)"/>
  <line id="pipe1_flow" x1="200" y1="260" x2="360" y2="260" stroke="#38bdf8" stroke-width="6" stroke-dasharray="8 4"/>
  <circle id="pump1_body" cx="400" cy="260" r="22" fill="#cfd4dd" stroke="#333"/>
</svg>
```
绑定：`tk1_level` 用 height（valueFrom/valueTo=量程，from=0,to=液位最大像素高）；`pump1_body` 绑泵运行输出（fill 灰/绿，含 on+off 两态）。

### 骨架 C：指针表盘
```svg
<svg viewBox="0 0 160 160">
  <circle cx="80" cy="80" r="74" fill="#eef0f4" stroke="#333" stroke-width="2"/>
  <circle cx="80" cy="80" r="5" fill="#384150"/>
  <g transform="translate(80,80)">
    <line id="g1_needle" data-anchor="needle" x1="0" y1="0" x2="0" y2="-60" stroke="#e11d48" stroke-width="3"/>
  </g>
</svg>
```
绑定：`g1_needle` 用 rotate（needle 已在 `translate(80,80)` 组内、以 (0,0) 为轴心，`rotate(N)` 天然绕圆心）。`degPerUnit` 按量程换算（如 0–100 → 0–270°，degPerUnit=2.7）。

### 骨架 D：垂直升降（电梯 / 码垛升降台）
```svg
<svg viewBox="0 0 200 400">
  <!-- 井道 -->
  <rect x="60" y="20" width="80" height="360" fill="none" stroke="#333" stroke-width="2"/>
  <!-- 轿厢/升降台 -->
  <rect id="lift_cab" x="65" y="340" width="70" height="40" rx="4" fill="#64748b"/>
  <!-- 楼层标记 -->
  <line x1="55" y1="340" x2="145" y2="340" stroke="#9ca3af" stroke-dasharray="4 2"/>
  <line x1="55" y1="220" x2="145" y2="220" stroke="#9ca3af" stroke-dasharray="4 2"/>
  <line x1="55" y1="100" x2="145" y2="100" stroke="#9ca3af" stroke-dasharray="4 2"/>
</svg>
```
绑定：`lift_cab` 用 **translateY 绝对写法**，绑一个 INT 位置量（程序自驱的 `%QW` 输出）：`valueFrom=0`（底层）、`valueTo=楼层数`（如 3）、`yFrom=340`（轿厢绘制位=底层 y）、`yTo=100`（顶层 y）——yFrom/yTo 是轿厢(bbox 顶边)要**到达的绝对 y**，照楼层线坐标直接写，工具自动换算（无需关心 SVG y 轴方向/负值）。码垛升降同理。（遗留:相对 from/to 仍可用,但勿与绝对字段混写。）

## 坐标约定（防 LLM 坐标幻觉）

以 canvas 宽高为基准用比例，不要凭空写绝对值：
- 主轴基线：`y = canvas.height * 0.55`（800×450 → y≈248）。
- N 个工位横向均布：第 i 个 `x = canvas.width * (i+1)/(N+1)`。
- 液位/料位：用 `transform="translate(0,BASE) scale(1,-1)"`，height 向上长，BASE=容器底 y。
- 默认画布 800×450；上面骨架数值即按此画布给出，按需等比缩放。

## stack-light 三 binding 示例

`stack-light` 是多 binding 件：三段各用具名 target（`red`/`amber`/`green`），**每段 fill map 必须含 on+off 两条**（否则灭不掉、粘色）：
```json
{
  "id": "tower1", "kind": "stack-light", "x": 360, "y": 40,
  "bindings": [
    { "variable": "alarm_red",   "target": "red",   "effect": { "type": "fill", "map": [
      { "when": { "eq": true }, "color": "#ef4444" }, { "when": { "eq": false }, "color": "#5a1a1a" } ] } },
    { "variable": "warn_amber",  "target": "amber", "effect": { "type": "fill", "map": [
      { "when": { "eq": true }, "color": "#f59e0b" }, { "when": { "eq": false }, "color": "#5a4a1a" } ] } },
    { "variable": "ok_green",    "target": "green", "effect": { "type": "fill", "map": [
      { "when": { "eq": true }, "color": "#22c55e" }, { "when": { "eq": false }, "color": "#1a5a2a" } ] } }
  ]
}
```

## 输入是可交互的(点 BOOL / 拖模拟量)

画布支持两类输入交互,**都要求程序处于运行中**:
- **BOOL 输入(`%IX`)→ 可点击切换(toggle)**:**可点 = 有一条绑定引用这个 BOOL 输入**。custom 给按钮一个 `id` 并用 `target` 指它(**`target` 必须与 svg 里的 `id` 大小写完全一致**,否则前端点不动、`plc_buildSimulation` 会 `ok:false` 打回),只那个按钮可点;省了 `target` 则整图都可点、多按钮会互撞;库部件 `sensor-button` 绑输入则整件可点、不用 target。点一下把该输入**置 true 并保持**(持久 force),再点一下置回 false——**保持型开关**(启动/停止/模式/使能)点一下稳定开启,**传感器/边沿逻辑**每次"点开"=一个上升沿。那条 fill 顺带当**按下反馈**(on=亮=已点到 true),是输入态反馈、不是输出动画。可抄模板(完整 part 壳,id 前缀=part.id):

  ```json
  {
    "id": "ctrl1", "kind": "custom", "x": 40, "y": 120,
    "svg": "<svg viewBox=\"0 0 120 60\"><rect id=\"ctrl1_startbtn\" x=\"10\" y=\"16\" width=\"60\" height=\"28\" rx=\"4\" fill=\"#64748b\"/></svg>",
    "bindings": [
      { "variable": "start_btn", "target": "ctrl1_startbtn",
        "effect": { "type": "fill", "map": [
          { "when": { "eq": true },  "color": "#22c55e" },
          { "when": { "eq": false }, "color": "#64748b" } ] } }
    ]
  }
  ```

  (抄用时把 `start_btn` 换成 `plc_detectIO` 列出的实际输入名、`ctrl1`/`ctrl1_startbtn` 换成你的 part.id 及其 svg 元素 id。)

- **模拟量输入(`%IW`/`%ID` 等)→ 可拖动**:用 `slider` 部件绑数值输入(设定值/手动量),用户拖动滑块经 `plc:force` 写值、拇指随实时 PLC 值反映(双向)。`%IW`/数值 force 已实测可用(`isForceable` 支持所有已定位 elementary 类型)。设定值/手动给定类输入**优先做成 slider**;只读传感读数用 `gauge`/`numeric-display`。

所以:
- **事件/计数类程序**(到位传感器→计数)在仿真里默认静止——`%IX` 恒为 0,要**点传感器**才会推进;生成场景后在收尾里提示用户"点传感器投料"。
- **设定值/连续控制类程序**(PID、双位、调速)把设定/手动量做成 slider,收尾里提示用户"拖滑块调设定值,看被控量追上去"。
- 模拟量也可在「变量」tab 用 Force 直接设值(等价路径)。

## 绑定要忠于变量(别硬凑)

只把动画绑到**真实存在、语义匹配**的变量:传送带"运行滚动"应绑到皮带电机/运行**输出**;若程序里没有这个量,就**别**把它硬绑到无关输入(如传感器),否则画面误导。宁可让该部件静止,或在 custom 图里只画不绑。

## 别重复调用

`plc_buildSimulation` **一次校验通过(ok:true)就停**——不要反复重生成同一场景(实测有过连调 6 次)。要改场景就改 Scene Spec 再调一次,而不是试错式重复。

`plc_buildSimulation` 返回的 `warnings[]` **分两类,区别对待**(别一刀切"ok:true 就全忽略"):
- **完整性警告(必须修)**:`数值量被绑到 BOOL 类部件`(计数/状态绑灯,值根本显示不出来)、`stack-light binding 不足`(某段灭不掉、粘色)。这类说明画面没忠实反映信号——改 Scene Spec(或回 ST 加自驱量)再调一次,**不要拿"ok:true 即停"豁免它们**。
- **装饰性警告(可即停)**:越界、可能粘色等纯观感问题——`ok:true` 即停,不必因它们重新生成。

> **"场景画了传送带却无工件移动" 已升级为硬错误(`ok:false`,不写 scene.json),不再是警告。** 命中时必须二选一:① 给工件绑自驱位置量(ST 里加 `belt_pos AT %QWn` 自增/回环,再 `translateX` 绑它);② 若本程序确无运动,改用**不画传送带**的库部件 dashboard。详见上文《有空间关系的场景》硬约束 ②。

## scene 怎么传(避免"散乱网格")

有空间关系的场景**必须把你设计的 custom 整图通过 `scene` 参数传给 `plc_buildSimulation`**——这是让画面有正确位置关系的唯一途径。注意:
- scene 较大(>3KB)或反复传参畸形时,`write_file` 写到 `config/scene_draft.json` 再用 `scenePath` 传(见下),不要把 scene 序列化成字符串硬塞 tool-call。
- **不要**因为传 scene 失败就退回"空 scene 自动建议"或"直接写 `config/scene.json` 绕过"——空 scene 只会得到两列散乱网格(库部件无空间关系),正是要避免的结果。先把 scene 真正传进去。
- 传进去后看返回:`autoSuggested:false` 表示用了你的 custom 整图(对);`autoSuggested:true` 表示 scene 没收到、走了兜底(说明上面的传参没成功,需重传)。

> 最小合法 scene 的精确字段名见本文开头《最小合法 scene》一节。
