(* 模式:双位(bang-bang)回差控制 + 自驱 plant(水箱/温控通用骨架)
   核心:液位低于 LOW 开阀,高于 HIGH 关阀,中间保持(回差防频繁切换)。
   plant 模型:开阀时液位升、关阀时降,饱和到 [0, 1000]。
   改写要点:
   - 改 LOW/HIGH 阈值
   - 改 plant 动态(升降速率、是否有恒定泄漏)
   - 温控场景:valve→heater, level→temperature, 降=自然散热 *)
PROGRAM tank_bangbang
  VAR
    level AT %QW0 : INT;            (* 当前液位:自驱量,仿真绑它 *)
    inlet_valve AT %QX0.0 : BOOL;   (* 进水阀开关 *)
  END_VAR
  VAR
    LOW : INT := 200;               (* 下限阈值 *)
    HIGH : INT := 800;              (* 上限阈值 *)
  END_VAR

  (* 回差逻辑:低于下限开、高于上限关、中间保持上一状态 *)
  IF level < LOW THEN
    inlet_valve := TRUE;
  ELSIF level > HIGH THEN
    inlet_valve := FALSE;
  END_IF;

  (* === plant 模型(自驱,仿真能动的关键)=== *)
  IF inlet_valve THEN
    level := level + 5;             (* 开阀:每周期升 5 *)
  ELSE
    level := level - 3;             (* 关阀:自然泄漏降 3 *)
  END_IF;

  (* 饱和 *)
  IF level > 1000 THEN level := 1000; END_IF;
  IF level < 0 THEN level := 0; END_IF;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#50ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : tank_bangbang;
  END_RESOURCE
END_CONFIGURATION
