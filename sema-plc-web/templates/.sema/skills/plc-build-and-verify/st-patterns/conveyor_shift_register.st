(* 模式:传送带工件追踪 + 移位寄存器分拣(最难场景骨架)
   验证纪律(关键):移位寄存器单脉冲几个周期就移走,任何采样都追不上——
   verify 时用 steady+pulseScans 投一个干净脉冲,断言它【留下的持久后果】
   (推杆锁存 / 计数 +1),别设计逐格追 bit 的工况。
   仿真:工件位置 wp_pos 是内部自驱量(随带走),translateX 绑它。
   改写要点:改料道数、传感器位置阈值、SLOTS 长度 *)
PROGRAM conveyor_sort
  VAR
    belt_run AT %IX0.0 : BOOL;        (* 启动传送带 *)
    color_sensor AT %IX0.1 : BOOL;    (* 入口颜色/检测传感器(脉冲)*)
    wp_pos AT %QW0 : INT;             (* 工件位置 0-1000:自驱量,仿真 translateX 绑它 *)
    pusher1 AT %QX0.0 : BOOL;         (* 料道1推杆 *)
    sort_count AT %QW1 : INT;         (* 已分拣计数 *)
  END_VAR
  VAR
    sensor_edge : R_TRIG;
    item_on_belt : BOOL := FALSE;     (* 带上有工件(锁存)*)
    push_latch : TON;                 (* 推杆动作保持 *)
  END_VAR

  sensor_edge(CLK := color_sensor);

  (* 入口检测到工件 → 锁存"带上有工件",位置归零开始走 *)
  IF sensor_edge.Q AND NOT item_on_belt THEN
    item_on_belt := TRUE;
    wp_pos := 0;
  END_IF;

  (* === plant:工件随带前进(自驱量,仿真动画的关键)=== *)
  IF belt_run AND item_on_belt THEN
    wp_pos := wp_pos + 10;
  END_IF;

  (* 到达料道1工位(阈值 500)→ 触发推杆 + 计数 +1(持久后果)*)
  IF item_on_belt AND wp_pos >= 500 THEN
    push_latch(IN := TRUE, PT := T#500ms);
    pusher1 := TRUE;
    IF wp_pos >= 510 AND wp_pos <= 520 THEN   (* 只在跨过工位的那一刻计数一次 *)
      sort_count := sort_count + 1;
    END_IF;
  END_IF;

  (* 工件走到带尾 → 复位,等下一个 *)
  IF wp_pos >= 1000 THEN
    item_on_belt := FALSE;
    pusher1 := FALSE;
    push_latch(IN := FALSE);
  END_IF;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#50ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : conveyor_sort;
  END_RESOURCE
END_CONFIGURATION
