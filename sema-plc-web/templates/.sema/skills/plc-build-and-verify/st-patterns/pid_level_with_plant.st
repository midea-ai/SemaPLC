(* 模式:连续量闭环 + 内部 plant 自驱(液位/温度/流量 PID 或比例通用)
   关键(S1 硬门要求):被仿真的连续量(level)必须是【程序自驱的内部量/输出】,
   不能是 %IW 外部输入——否则实时仿真里它恒为初值=死图。
   改写要点:
   - 设定值 setpoint 做成 %IW 输入(用户拖 slider 给)
   - 反馈量 level 是内部 plant:由阀门开度自驱(进>出则升,反之降),饱和到 [0,1000]
   - 仿真把 height 绑到 level(自驱量),slider 绑到 setpoint(%IW) *)
PROGRAM pid_level
  VAR
    setpoint AT %IW0 : INT;     (* 设定值 0-1000,用户 slider 驱动 *)
    valve AT %QW0 : INT;        (* 阀门开度输出 0-1000 *)
    level AT %QW1 : INT;        (* 液位:做成输出/自驱量,仿真绑它 *)
  END_VAR
  VAR
    err : INT;
    inflow : INT;
  END_VAR

  (* === 控制器:比例控制,阀门开度随偏差 === *)
  err := setpoint - level;
  IF err > 0 THEN
    valve := err * 2;           (* 偏差越大开越大;按需换成完整 PID *)
    IF valve > 1000 THEN valve := 1000; END_IF;
  ELSE
    valve := 0;
  END_IF;

  (* === plant 模型(自驱闭环,这段是仿真能动起来的关键)===
     进水正比阀门开度,出水恒定泄漏;液位 = 上次 + 进 - 出,饱和 *)
  inflow := valve / 100;        (* 阀全开每周期进 10 *)
  level := level + inflow - 3;  (* 恒定泄漏 3 *)
  IF level > 1000 THEN level := 1000; END_IF;
  IF level < 0 THEN level := 0; END_IF;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#50ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : pid_level;
  END_RESOURCE
END_CONFIGURATION
