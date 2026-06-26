(* 模式:N 状态机 + TON 定时器(红绿灯/顺序动作通用骨架)
   改写要点:
   - 改 state 取值数与每态的输出映射、PT 时长
   - 倒计时量 countdown 自动从定时器派生,直接绑数显
   - 这是"离散状态机自驱",部署即自动循环,无需外部输入 *)
PROGRAM state_machine
  VAR
    (* 输出:按需改名/增减 *)
    out_a AT %QX0.0 : BOOL;
    out_b AT %QX0.1 : BOOL;
    out_c AT %QX0.2 : BOOL;
    countdown AT %QW0 : INT;
  END_VAR
  VAR
    state : INT := 0;          (* 0/1/2... 按需扩展 *)
    cnt : INT := 0;            (* 当前态剩余秒 *)
    phase_timer : TON;
    tick : R_TRIG;
  END_VAR

  (* 1Hz 自激节拍:timer.Q 每秒翻一次,R_TRIG 取上升沿 = 每秒一个 tick *)
  phase_timer(IN := NOT phase_timer.Q, PT := T#1s);
  tick(CLK := phase_timer.Q);

  (* 首扫描初始化当前态时长(避免 cnt 初值 0 直接跳态)*)
  IF state = 0 AND cnt = 0 THEN cnt := 3; END_IF;

  IF tick.Q THEN
    cnt := cnt - 1;
    IF cnt <= 0 THEN
      CASE state OF
        0: state := 1; cnt := 1;   (* 态0持续3s → 态1持续1s *)
        1: state := 2; cnt := 2;   (* 态1 → 态2持续2s *)
        2: state := 0; cnt := 3;   (* 态2 → 回态0 *)
      END_CASE;
    END_IF;
  END_IF;

  (* 输出映射:任一时刻只有一个有效(按需改)*)
  out_a := (state = 0);
  out_b := (state = 1);
  out_c := (state = 2);
  countdown := cnt;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK Main(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM Inst0 WITH Main : state_machine;
  END_RESOURCE
END_CONFIGURATION
