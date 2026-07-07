(* 模式:输入驱动锁存 + 优先级覆盖(电机启停/阀门启停通用骨架)
   核心:motor := (start OR motor) AND NOT stop AND NOT estop
   急停/停止在 AND 链末端 → 天然最高优先(同时按下时停止必赢)。
   改写要点:
   - 改输入/输出名与数量
   - 多组互锁:复制锁存行,加互斥条件(如 motor1 AND NOT motor2)
   - 需要脉冲启动(按一下松开仍保持)时已内建——start 松开后 motor 自锁 *)
PROGRAM motor_latch
  VAR
    start_btn AT %IX0.0 : BOOL;   (* 启动按钮 *)
    stop_btn AT %IX0.1 : BOOL;    (* 停止按钮 *)
    estop AT %IX0.2 : BOOL;       (* 急停,优先级最高 *)
    motor AT %QX0.0 : BOOL;       (* 电机输出 *)
    run_light AT %QX0.1 : BOOL;   (* 运行指示灯 *)
  END_VAR

  (* 一行锁存:start 上升沿置位,stop/estop 随时复位;
     estop 在最外层 AND NOT → 即使 start 持续按住也能停 *)
  motor := (start_btn OR motor) AND NOT stop_btn AND NOT estop;
  run_light := motor;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : motor_latch;
  END_RESOURCE
END_CONFIGURATION
