(* 模式:R_TRIG 边沿计数 + 下限钳位 + 阈值比较输出(停车场/产线计数通用骨架)
   核心:两个 R_TRIG 分别取入口/出口上升沿,驱动 INT 加/减,
   与上限比较控制 BOOL 输出(满位灯/闸机)。
   改写要点:
   - 改传感器数量(单向计数只保留 entry_edge)
   - 改上限值(MAX_COUNT)
   - 加多级阈值(如 80% 预警灯) *)
PROGRAM parking_counter
  VAR
    entry_sensor AT %IX0.0 : BOOL;   (* 入口传感器 *)
    exit_sensor AT %IX0.1 : BOOL;    (* 出口传感器 *)
    car_count AT %QW0 : INT;         (* 当前车辆数 *)
    full_light AT %QX0.0 : BOOL;     (* 满位指示灯 *)
    gate_entry AT %QX0.1 : BOOL;     (* 入口闸机,TRUE=放行 *)
  END_VAR
  VAR
    entry_edge : R_TRIG;
    exit_edge : R_TRIG;
    MAX_COUNT : INT := 10;           (* 车位上限,按需改 *)
  END_VAR

  entry_edge(CLK := entry_sensor);
  exit_edge(CLK := exit_sensor);

  (* 加减计数,下限钳 0 *)
  IF entry_edge.Q THEN
    car_count := car_count + 1;
  END_IF;
  IF exit_edge.Q AND car_count > 0 THEN
    car_count := car_count - 1;
  END_IF;

  (* 阈值比较 → 输出 *)
  full_light := (car_count >= MAX_COUNT);
  gate_entry := (car_count < MAX_COUNT);
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : parking_counter;
  END_RESOURCE
END_CONFIGURATION
