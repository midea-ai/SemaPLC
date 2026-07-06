import type { Lang } from './store'

export interface Scenario {
  id: string
  title: { zh: string; en: string }
  prompt: { zh: string; en: string }
}

export const scenarios: Scenario[] = [
  { id: 'motor-start-stop',
    title: { zh: '电机启停控制', en: 'Motor Start/Stop Control' },
    prompt: { zh: '电机启停控制：按启动按钮电机运转并自锁，按停止或急停立即停止（急停优先级最高）。初始上电时电机停、灯灭。停止或急停后可再次按启动恢复运转。仿真画面：一个电机图标 + 一盏运行指示灯；点『启动』电机转、灯亮，点『急停』立即停、灯灭。启动/停止/急停三个输入做成可点击按钮。',
      en: 'Motor start/stop control: pressing the Start button runs the motor and latches it on (self-holding); pressing Stop or E-stop halts it immediately (E-stop has the highest priority). On initial power-up the motor is off and the lamp is dark. After a Stop or E-stop the motor can be restarted by pressing Start again. Simulation view: one motor icon plus one running indicator lamp; clicking "Start" spins the motor and lights the lamp, clicking "E-stop" stops it instantly and turns the lamp off. Make the three inputs — Start, Stop, E-stop — clickable inputs.' } },
  { id: 'traffic-light',
    title: { zh: '红绿灯定时控制', en: 'Traffic Light Timing Control' },
    prompt: { zh: '红绿灯定时控制：交通灯按 绿3秒→黄1秒→红2秒 固定时序循环，任一时刻只有一盏亮。仿真画面：竖排红黄绿三色圆灯 + 一个倒计时数字；三个灯各自绑定对应的灯输出（当前相位灯亮、其余灭），倒计时数字随相位实时递减、到零切换。',
      en: 'Traffic light timing control: the traffic light cycles on a fixed sequence of Green 3s → Yellow 1s → Red 2s, with only one lamp lit at any moment. Simulation view: a vertical stack of red, yellow, and green round lamps plus a countdown number; each of the three lamps is bound to its corresponding lamp output (the current-phase lamp lit, the others off), and the countdown number decrements in real time with the phase and switches phase when it reaches zero.' } },
  { id: 'conveyor-sort',
    title: { zh: '传送带颜色/高度分拣', en: 'Conveyor Color/Height Sorting' },
    prompt: { zh: '传送带颜色/高度分拣：用一个启停输入控制传送带运转，传送带停止时工件不移动。传感器识别颜色/高度，到对应工位时推杆伸出推走，推杆动作后自动缩回；无传感器信号时推杆不动作。工件走到带尾后位置自动复位，准备接收下一个工件，每个工件分别计数。实现从简即可（用一个自驱的位置量 + 简单状态跟踪工件，不必上移位寄存器）。仿真画面：一条传送带 + 一个沿带移动的工件方块（由自驱位置量驱动）+ 传感器 + 推杆；工件到位时推杆伸出推走，直观展示分拣。',
      en: 'Conveyor color/height sorting: a start/stop input controls the conveyor belt — the workpiece does not move when the belt is stopped. A sensor identifies color/height; when the workpiece reaches the corresponding station the pusher extends to eject it and then automatically retracts; the pusher must not act when there is no sensor signal. When the workpiece reaches the end of the belt its position resets automatically, ready for the next workpiece, and each workpiece is counted separately. Keep the implementation simple (use one self-driven position variable plus simple state to track the workpiece — no need for a shift register). Simulation view: a conveyor belt plus a workpiece block moving along it (driven by the self-driven position variable) plus a sensor plus a pusher; when the workpiece is in position, the pusher extends and ejects it, visibly demonstrating the sorting.' } },
  { id: 'cylinder-seq',
    title: { zh: '气缸顺序往复控制', en: 'Sequential Pneumatic Cylinder Control' },
    prompt: { zh: '气缸顺序往复控制：A伸出→A缩回→B伸出→B缩回 循环动作。仿真要能自动按节拍循环演示——每步到位后自动进入下一步（仿真里用定时器或自驱位置量推进，不要卡在等没人驱动的外部限位开关）。画面：气缸活塞杆伸缩动画 + 两端到位指示点亮，按节拍循环往复。',
      en: 'Sequential pneumatic cylinder control: a repeating cycle of A extend → A retract → B extend → B retract. The simulation must cycle automatically on a beat — after each step reaches position it advances to the next automatically (drive the steps with timers or a self-driven position variable; don\'t stall waiting on un-driven external limit switches). View: piston rods animating in and out plus end-of-travel position indicators lighting up, reciprocating on a beat.' } },
  { id: 'level-pid',
    title: { zh: '液位/流量 PID 控制', en: 'Level/Flow PID Control' },
    prompt: { zh: '液位调节控制：调节进水阀把罐内液位稳定在设定值；设定值改变后液位应重新收敛到新值。实现可用简化的比例/分段调节（不必完整 PID 功能块）。仿真要自动演示液位逼近设定值：用一个自驱的液位量（进水时升、出水时降，随阀门开度变化）驱动罐体液面实时升降。画面：罐体 + 实时升降的液面 + 阀门开度可视 + 设定值参考线。',
      en: 'Level regulation control: modulate the inlet valve to hold the tank level steady at a setpoint; when the setpoint changes the level must re-converge to the new value. The implementation may use a simplified proportional / piecewise regulation (no need for a full PID function block). The simulation must auto-demonstrate the level converging toward the setpoint: use a self-driven level variable (rises while filling, falls while draining, varying with valve opening) to drive the tank\'s liquid surface up and down in real time. View: the tank plus a liquid surface that rises and falls in real time plus a visualized valve opening plus a setpoint reference line.' } },
  { id: 'tank-bangbang',
    title: { zh: '水箱双位(开关)控制', en: 'Tank Bang-Bang (On/Off) Control' },
    prompt: { zh: '水箱双位（bang-bang）控制：液位低于下限开进水阀、高于上限关，在两个限位之间自动来回。仿真要自动锯齿起伏：用一个自驱的液位量（开阀升、关阀降），阀门逻辑直接判液位阈值带回差（不要依赖没人驱动的外部液位开关）。画面：罐体液位在上下限之间锯齿状起伏，进水阀随液位触底打开、触顶关闭。',
      en: 'Tank bang-bang (on/off) control: when the level drops below the low limit, open the inlet valve; when it rises above the high limit, close it — cycling back and forth automatically between the two limits. The simulation must produce an automatic sawtooth oscillation: use a self-driven level variable (rises with the valve open, falls with it closed), and have the valve logic decide directly on the level thresholds with hysteresis (don\'t rely on un-driven external level switches). View: the tank level oscillating in a sawtooth between the low and high limits, the inlet valve opening when the level bottoms out and closing when it tops out.' } },
  { id: 'palletize',
    title: { zh: '码垛堆叠控制', en: 'Palletizing / Stacking Control' },
    prompt: { zh: '码垛堆叠控制：机械手把箱子按层码放到托盘上，码满一垛换托盘。实现从简（用计数器统计数量/层数即可）。仿真画面：机械手抓放动画 + 托盘上箱垛逐层升高 + 计数与层数数字显示，按节拍自动演示堆叠过程。',
      en: 'Palletizing / stacking control: a manipulator stacks boxes layer by layer onto a pallet, swapping the pallet once a stack is full. Keep the implementation simple (just use counters to track box count / layer count). Simulation view: a manipulator pick-and-place animation plus a box stack on the pallet growing taller layer by layer plus numeric displays of count and layer, auto-demonstrating the stacking process on a beat.' } },
  { id: 'pick-place',
    title: { zh: '装配/抓放(Pick & Place)控制', en: 'Assembly / Pick-and-Place Control' },
    prompt: { zh: '装配/抓放控制：抓取机构按 下降-夹取-上升-平移-下降-释放-复位 的固定时序工作。仿真自动按节拍演示——每步用定时器自动推进（不卡在等没人驱动的外部到位传感器）。画面：抓取机构按轨迹抓起工件、移动、放下与底座合体，循环演示装配节拍。',
      en: 'Assembly / pick-and-place control: the gripper mechanism works on a fixed sequence of descend → grip → ascend → traverse → descend → release → home. The simulation auto-demonstrates on a beat — each step is advanced automatically by a timer (without stalling on un-driven external in-position sensors). View: the gripper following its trajectory to pick up the workpiece, move it, set it down and mate it with the base, cyclically demonstrating the assembly beat.' } },
  { id: 'elevator',
    title: { zh: '电梯/楼层呼叫控制', en: 'Elevator / Floor Call Control' },
    prompt: { zh: '电梯楼层呼叫控制：电梯初始停在层0，无呼叫时上下行电机均停且两者互斥（不能同时为 true）。电梯响应各楼层的呼叫请求，移动到目标楼层停靠并开门，到达后呼叫灯熄灭、门自动关闭，再响应下一个。实现从简即可（按目标楼层就近响应/顺序处理即可，不必实现完整的请求队列调度算法）。仿真画面：一张电梯井道整图，轿厢用一个自驱的位置量在楼层间平滑上下移动，被呼叫的楼层按钮点亮，轿厢到达目标层时停靠开门。',
      en: 'Elevator floor-call control: the elevator starts at floor 0; when idle both the up and down motors are off, and they are mutually exclusive (never both true at the same time). The elevator answers call requests from the various floors, moving to the target floor to stop and open its doors; on arrival the call lamp turns off and the door closes automatically, then it serves the next request. Keep the implementation simple (nearest-floor or sequential handling of target floors is fine — no need to implement a full request-queue scheduling algorithm). Simulation view: a full custom drawing of the elevator shaft, with the car moving smoothly up and down between floors via a self-driven position variable, the called floor\'s button lit, and the car stopping and opening its doors when it reaches the target floor.' } },
  { id: 'parking-count',
    title: { zh: '停车场/通道计数控制', en: 'Parking Lot / Gate Counting Control' },
    prompt: { zh: '停车场计数控制：初始状态车场为空、满位灯灭、入口闸机放行。统计进出车辆，车位满时禁止入场点亮满位灯、有空位时放行抬杆；满位后有车驶出时应恢复放行并熄灭满位灯。逻辑是一个加减计数器：入口传感器触发加一、出口减一，计数不低于零（空场时出口脉冲不减），与上限比较控制闸机和满位灯。仿真画面：进/出口闸机的抬落动画 + 一个实时车位数字 + 满位时红灯；进出口传感器做成可点击。',
      en: 'Parking lot counting control: initially the lot is empty, the full indicator is off, and the entry gate is open. Count vehicles entering and leaving; when the lot is full, deny entry and light the full indicator; when a space becomes free, allow entry and raise the barrier — after being full, a single exit must restore entry and turn off the full indicator. The logic is one up/down counter: the entry sensor triggers an increment, the exit sensor a decrement, the count never goes below zero (an exit pulse on an empty lot does not decrement), compared against the capacity limit to control the gate and the full indicator. Simulation view: raise/lower animations of the entry and exit barriers plus a live free-space number plus a red full indicator when full; make the entry and exit sensors clickable inputs.' } },
]

export function scenarioTitle(s: Scenario, lang: Lang): string { return s.title[lang] }
export function scenarioPrompt(s: Scenario, lang: Lang): string { return s.prompt[lang] }
