import type { VerifyPlan, Scalar } from '../../../sema-plc-tools/src/verify/planTypes'

const MOTOR_RUN: Record<string, Scalar> = { start_btn: true, stop_btn: false, estop: false }
const MOTOR_STOP: Record<string, Scalar> = { start_btn: false, stop_btn: false, estop: false }
const PULSE2 = 2

export const scenarioPlans: Record<string, VerifyPlan> = {

  // ── 1. 电机启停控制 ──────────────────────────────────────────────────────────
  'motor-start-stop': {
    program: 'src/programs/motor_start_stop.st',
    options: { perCaseBudgetMs: 10000, stopAfter: true },
    cases: [
      {
        name: '初始空闲态→电机停+灯灭',
        type: 'steady',
        resetBefore: true,
        set: MOTOR_STOP,
        settleMs: 300,
        expect: [
          { var: 'motor', op: '==', value: false },
          { var: 'run_light', op: '==', value: false },
        ],
      },
      {
        name: '按下启动→电机运转+指示灯亮',
        type: 'steady',
        set: MOTOR_RUN,
        settleMs: 500,
        expect: [
          { var: 'motor', op: '==', value: true },
          { var: 'run_light', op: '==', value: true },
        ],
      },
      {
        name: '启动自锁后松开启动按钮→电机保持',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: MOTOR_RUN,
            pulseScans: PULSE2,
          },
          {
            settleMs: 500,
            expect: [
              { var: 'motor', op: '==', value: true },
              { var: 'run_light', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '运行中按停止→电机停转',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: MOTOR_RUN,
            waitFor: { var: 'motor', op: '==', value: true, timeoutMs: 3000 },
          },
          {
            set: { start_btn: false, stop_btn: true, estop: false },
            settleMs: 300,
            expect: [
              { var: 'motor', op: '==', value: false },
              { var: 'run_light', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '运行中急停→立即停机(急停优先于启动)',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: MOTOR_RUN,
            waitFor: { var: 'motor', op: '==', value: true, timeoutMs: 3000 },
          },
          {
            set: { start_btn: true, stop_btn: false, estop: true },
            settleMs: 300,
            expect: [
              { var: 'motor', op: '==', value: false },
              { var: 'run_light', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '停止后重新启动→恢复运转',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: MOTOR_RUN,
            waitFor: { var: 'motor', op: '==', value: true, timeoutMs: 3000 },
          },
          {
            set: { start_btn: false, stop_btn: true, estop: false },
            waitFor: { var: 'motor', op: '==', value: false, timeoutMs: 3000 },
          },
          {
            set: MOTOR_RUN,
            settleMs: 500,
            expect: [
              { var: 'motor', op: '==', value: true },
              { var: 'run_light', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '急停后重新启动→恢复运转',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: MOTOR_RUN,
            waitFor: { var: 'motor', op: '==', value: true, timeoutMs: 3000 },
          },
          {
            set: { start_btn: false, stop_btn: false, estop: true },
            waitFor: { var: 'motor', op: '==', value: false, timeoutMs: 3000 },
          },
          {
            set: MOTOR_RUN,
            settleMs: 500,
            expect: [
              { var: 'motor', op: '==', value: true },
              { var: 'run_light', op: '==', value: true },
            ],
          },
        ],
      },
    ],
  },

  // ── 2. 红绿灯定时控制 ────────────────────────────────────────────────────────
  'traffic-light': {
    program: 'src/programs/traffic_light.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '三灯按绿→黄→红轮转',
        type: 'trace',
        vars: ['state'],
        durationMs: 8000,
        intervalMs: 200,
        expectShape: [
          { var: 'state', kind: 'cycle', sequence: [0, 1, 2] },
        ],
      },
      {
        name: '各相位灯映射正确(互斥:每态只亮一盏)',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            waitFor: { var: 'state', op: '==', value: 0, timeoutMs: 10000 },
            expect: [
              { var: 'green_light', op: '==', value: true },
              { var: 'yellow_light', op: '==', value: false },
              { var: 'red_light', op: '==', value: false },
            ],
          },
          {
            waitFor: { var: 'state', op: '==', value: 1, timeoutMs: 10000 },
            expect: [
              { var: 'green_light', op: '==', value: false },
              { var: 'yellow_light', op: '==', value: true },
              { var: 'red_light', op: '==', value: false },
            ],
          },
          {
            waitFor: { var: 'state', op: '==', value: 2, timeoutMs: 10000 },
            expect: [
              { var: 'green_light', op: '==', value: false },
              { var: 'yellow_light', op: '==', value: false },
              { var: 'red_light', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '倒计时数字在递减',
        type: 'trace',
        vars: ['countdown'],
        durationMs: 6000,
        intervalMs: 200,
        expectShape: [
          { var: 'countdown', kind: 'changed' },
        ],
      },
    ],
  },

  // ── 3. 传送带颜色/高度分拣 ──────────────────────────────────────────────────
  'conveyor-sort': {
    program: 'src/programs/conveyor_sort.st',
    options: { perCaseBudgetMs: 15000, stopAfter: true },
    cases: [
      {
        name: '工件位置量自驱推进',
        type: 'trace',
        vars: ['wp_pos'],
        durationMs: 5000,
        intervalMs: 200,
        set: { belt_run: true },
        expectShape: [
          { var: 'wp_pos', kind: 'changed' },
        ],
      },
      {
        name: '传送带未启动时工件不移动',
        type: 'trace',
        vars: ['wp_pos'],
        durationMs: 3000,
        intervalMs: 200,
        resetBefore: true,
        set: { belt_run: false },
        expectShape: [
          { var: 'wp_pos', kind: 'range', min: 0, max: 0 },
        ],
      },
      {
        name: '传感器脉冲后推杆动作+计数加一',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { belt_run: true, color_sensor: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'pusher', op: '==', value: true, timeoutMs: 10000 },
            expect: [
              { var: 'pusher', op: '==', value: true },
              { var: 'sort_count', op: '>=', value: 1 },
            ],
          },
        ],
      },
      {
        name: '无传感器信号时推杆不动作',
        type: 'steady',
        resetBefore: true,
        set: { belt_run: true, color_sensor: false },
        settleMs: 2000,
        expect: [
          { var: 'pusher', op: '==', value: false },
          { var: 'sort_count', op: '==', value: 0 },
        ],
      },
      {
        name: '推杆动作后自动缩回',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { belt_run: true, color_sensor: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'pusher', op: '==', value: true, timeoutMs: 10000 },
          },
          {
            waitFor: { var: 'pusher', op: '==', value: false, timeoutMs: 5000 },
            expect: [
              { var: 'pusher', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '工件走到带尾后位置复位(循环准备)',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { belt_run: true, color_sensor: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'wp_pos', op: '>=', value: 900, timeoutMs: 15000 },
          },
          {
            waitFor: { var: 'wp_pos', op: '<=', value: 100, timeoutMs: 5000 },
            expect: [
              { var: 'pusher', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '连续两个工件分别计数',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { belt_run: true, color_sensor: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'sort_count', op: '>=', value: 1, timeoutMs: 12000 },
          },
          {
            waitFor: { var: 'wp_pos', op: '<=', value: 50, timeoutMs: 8000 },
          },
          {
            set: { belt_run: true, color_sensor: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'sort_count', op: '>=', value: 2, timeoutMs: 12000 },
            expect: [
              { var: 'sort_count', op: '>=', value: 2 },
            ],
          },
        ],
      },
    ],
  },

  // ── 4. 气缸顺序往复控制 ──────────────────────────────────────────────────────
  'cylinder-seq': {
    program: 'src/programs/cylinder_seq.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '状态机按A伸→A缩→B伸→B缩轮转',
        type: 'trace',
        vars: ['state'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'state', kind: 'cycle', sequence: [0, 1, 2, 3] },
        ],
      },
      {
        name: '气缸A输出有变化',
        type: 'trace',
        vars: ['cyl_a'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'cyl_a', kind: 'changed' },
        ],
      },
      {
        name: '气缸B输出有变化',
        type: 'trace',
        vars: ['cyl_b'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'cyl_b', kind: 'changed' },
        ],
      },
    ],
  },

  // ── 5. 液位/流量 PID 控制 ────────────────────────────────────────────────────
  'level-pid': {
    program: 'src/programs/level_pid.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '给定设定值后液位收敛',
        type: 'trace',
        vars: ['level'],
        durationMs: 8000,
        intervalMs: 200,
        set: { setpoint: 500 },
        expectShape: [
          { var: 'level', kind: 'settle', min: 400, max: 600 },
        ],
      },
      {
        name: '阀门开度有响应',
        type: 'trace',
        vars: ['valve'],
        durationMs: 6000,
        intervalMs: 200,
        set: { setpoint: 500 },
        expectShape: [
          { var: 'valve', kind: 'changed' },
        ],
      },
      {
        name: '切换设定值后液位重新收敛',
        type: 'trace',
        vars: ['level'],
        durationMs: 8000,
        intervalMs: 200,
        set: { setpoint: 800 },
        expectShape: [
          { var: 'level', kind: 'settle', min: 650, max: 950 },
        ],
      },
    ],
  },

  // ── 6. 水箱双位(开关)控制 ────────────────────────────────────────────────────
  'tank-bangbang': {
    program: 'src/programs/tank_bangbang.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '液位在上下限之间锯齿起伏',
        type: 'trace',
        vars: ['level'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'level', kind: 'changed' },
        ],
      },
      {
        name: '进水阀随液位开关切换',
        type: 'trace',
        vars: ['inlet_valve'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'inlet_valve', kind: 'changed' },
        ],
      },
      {
        name: '液位始终在合理范围内(0~1000)',
        type: 'trace',
        vars: ['level'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'level', kind: 'range', min: 0, max: 1000 },
        ],
      },
    ],
  },

  // ── 7. 码垛堆叠控制 ──────────────────────────────────────────────────────────
  'palletize': {
    program: 'src/programs/palletize.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '状态机自动循环(抓取节拍)',
        type: 'trace',
        vars: ['state'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'state', kind: 'changed' },
        ],
      },
      {
        name: '箱子计数在增长',
        type: 'trace',
        vars: ['box_count'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'box_count', kind: 'changed' },
        ],
      },
      {
        name: '层计数在增长',
        type: 'trace',
        vars: ['layer_count'],
        durationMs: 15000,
        intervalMs: 200,
        expectShape: [
          { var: 'layer_count', kind: 'changed' },
        ],
      },
      {
        name: '满垛换托盘(托盘计数增长)',
        type: 'trace',
        vars: ['pallet_count'],
        durationMs: 20000,
        intervalMs: 200,
        expectShape: [
          { var: 'pallet_count', kind: 'changed' },
        ],
      },
      {
        name: '机械手位置有运动',
        type: 'trace',
        vars: ['arm_pos'],
        durationMs: 8000,
        intervalMs: 200,
        expectShape: [
          { var: 'arm_pos', kind: 'changed' },
        ],
      },
    ],
  },

  // ── 8. 装配/抓放(Pick & Place)控制 ──────────────────────────────────────────
  'pick-place': {
    program: 'src/programs/pick_place.st',
    options: { perCaseBudgetMs: 20000, stopAfter: true },
    cases: [
      {
        name: '状态机按固定时序轮转(下降→夹取→上升→平移→下降→释放→复位)',
        type: 'trace',
        vars: ['state'],
        durationMs: 15000,
        intervalMs: 200,
        expectShape: [
          { var: 'state', kind: 'cycle', sequence: [0, 1, 2, 3, 4, 5, 6] },
        ],
      },
      {
        name: '夹爪有开合动作',
        type: 'trace',
        vars: ['gripper'],
        durationMs: 15000,
        intervalMs: 200,
        expectShape: [
          { var: 'gripper', kind: 'changed' },
        ],
      },
      {
        name: '垂直位置有运动',
        type: 'trace',
        vars: ['pos_y'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'pos_y', kind: 'changed' },
        ],
      },
      {
        name: '水平位置有平移运动',
        type: 'trace',
        vars: ['pos_x'],
        durationMs: 10000,
        intervalMs: 200,
        expectShape: [
          { var: 'pos_x', kind: 'changed' },
        ],
      },
    ],
  },

  // ── 9. 电梯/楼层呼叫控制 ────────────────────────────────────────────────────
  'elevator': {
    program: 'src/programs/elevator_control.st',
    options: { perCaseBudgetMs: 15000, stopAfter: true },
    cases: [
      {
        name: '初始在层0→无呼叫时电机均停',
        type: 'steady',
        resetBefore: true,
        set: { call0: false, call1: false, call2: false },
        settleMs: 500,
        expect: [
          { var: 'current_floor', op: '==', value: 0 },
          { var: 'motor_up', op: '==', value: false },
          { var: 'motor_down', op: '==', value: false },
        ],
      },
      {
        name: '呼叫层2→上行到层2并开门',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { call2: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'motor_up', op: '==', value: true, timeoutMs: 3000 },
            expect: [
              { var: 'motor_up', op: '==', value: true },
              { var: 'motor_down', op: '==', value: false },
            ],
          },
          {
            waitFor: { var: 'current_floor', op: '==', value: 2, timeoutMs: 15000 },
            settleMs: 500,
            expect: [
              { var: 'current_floor', op: '==', value: 2 },
            ],
          },
          {
            waitFor: { var: 'door_state', op: '==', value: true, timeoutMs: 5000 },
            expect: [
              { var: 'door_state', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '呼叫层1→上行到层1并开门',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { call1: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'current_floor', op: '==', value: 1, timeoutMs: 15000 },
            settleMs: 500,
            expect: [
              { var: 'current_floor', op: '==', value: 1 },
            ],
          },
          {
            waitFor: { var: 'door_state', op: '==', value: true, timeoutMs: 5000 },
            expect: [
              { var: 'door_state', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '到达后呼叫灯熄灭',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { call2: true },
            pulseScans: PULSE2,
            expect: [
              { var: 'call_light2', op: '==', value: true },
            ],
          },
          {
            waitFor: { var: 'current_floor', op: '==', value: 2, timeoutMs: 15000 },
            settleMs: 500,
            expect: [
              { var: 'call_light2', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '到达后开门→自动关门',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { call1: true },
            pulseScans: PULSE2,
          },
          {
            waitFor: { var: 'door_state', op: '==', value: true, timeoutMs: 15000 },
          },
          {
            waitFor: { var: 'door_state', op: '==', value: false, timeoutMs: 10000 },
            expect: [
              { var: 'door_state', op: '==', value: false },
            ],
          },
        ],
      },
      {
        name: '层2呼叫后再呼叫层0→依次响应并下行',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { call2: true },
            pulseScans: PULSE2,
          },
          {
            set: { call0: true },
            pulseScans: PULSE2,
            expect: [
              { var: 'call_light0', op: '==', value: true },
            ],
          },
          {
            waitFor: { var: 'current_floor', op: '==', value: 2, timeoutMs: 15000 },
            settleMs: 500,
          },
          {
            waitFor: { var: 'motor_down', op: '==', value: true, timeoutMs: 8000 },
            expect: [
              { var: 'motor_down', op: '==', value: true },
              { var: 'motor_up', op: '==', value: false },
            ],
          },
          {
            waitFor: { var: 'current_floor', op: '==', value: 0, timeoutMs: 15000 },
            settleMs: 300,
            expect: [
              { var: 'current_floor', op: '==', value: 0 },
              { var: 'call_light0', op: '==', value: false },
            ],
          },
          {
            waitFor: { var: 'door_state', op: '==', value: true, timeoutMs: 5000 },
            expect: [
              { var: 'door_state', op: '==', value: true },
            ],
          },
        ],
      },
      {
        name: '上下行电机均有动作',
        type: 'trace',
        vars: ['motor_up', 'motor_down'],
        durationMs: 8000,
        intervalMs: 200,
        expectShape: [
          { var: 'motor_up', kind: 'changed' },
          { var: 'motor_down', kind: 'changed' },
        ],
        // ponytail: 真正的互斥断言需要 ShapeExpect 新增 kind:'mutex'，当前只验证两个电机都动过
      },
    ],
  },

  // ── 10. 停车场/通道计数控制 ──────────────────────────────────────────────────
  'parking-count': {
    program: 'src/programs/parking_count.st',
    options: { perCaseBudgetMs: 10000, stopAfter: true },
    cases: [
      {
        name: '初始态→空位满+满位灯灭+闸机放行',
        type: 'steady',
        resetBefore: true,
        set: { entry_sensor: false, exit_sensor: false },
        settleMs: 300,
        expect: [
          { var: 'car_count', op: '==', value: 0 },
          { var: 'full_light', op: '==', value: false },
          { var: 'gate_entry', op: '==', value: true },
        ],
      },
      {
        name: '入口传感器脉冲→计数+1',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { entry_sensor: true },
            pulseScans: PULSE2,
            settleMs: 500,
          },
          {
            expect: [
              { var: 'car_count', op: '==', value: 1 },
            ],
          },
        ],
      },
      {
        name: '出口传感器脉冲→计数-1',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { entry_sensor: true },
            pulseScans: PULSE2,
            settleMs: 300,
          },
          {
            set: { exit_sensor: true },
            pulseScans: PULSE2,
            settleMs: 300,
          },
          {
            expect: [
              { var: 'car_count', op: '==', value: 0 },
            ],
          },
        ],
      },
      {
        name: '连续两次入场→计数为2',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { entry_sensor: true },
            pulseScans: PULSE2,
            settleMs: 300,
          },
          {
            set: { entry_sensor: true },
            pulseScans: PULSE2,
            settleMs: 300,
          },
          {
            expect: [
              { var: 'car_count', op: '==', value: 2 },
            ],
          },
        ],
      },
      {
        name: '空车场出口脉冲→计数不低于0',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { exit_sensor: true },
            pulseScans: PULSE2,
            settleMs: 300,
          },
          {
            expect: [
              { var: 'car_count', op: '>=', value: 0 },
            ],
          },
        ],
      },
      {
        name: '满位时满位灯亮+闸机拒入',
        type: 'steady',
        resetBefore: true,
        set: { car_count: 10 },
        settleMs: 500,
        expect: [
          { var: 'full_light', op: '==', value: true },
          { var: 'gate_entry', op: '==', value: false },
        ],
      },
      {
        name: '满位后出一辆→闸机恢复放行',
        type: 'sequence',
        resetBefore: true,
        steps: [
          {
            set: { car_count: 10 },
            settleMs: 300,
            expect: [
              { var: 'full_light', op: '==', value: true },
              { var: 'gate_entry', op: '==', value: false },
            ],
          },
          {
            set: { exit_sensor: true },
            pulseScans: PULSE2,
            settleMs: 500,
          },
          {
            expect: [
              { var: 'full_light', op: '==', value: false },
              { var: 'gate_entry', op: '==', value: true },
            ],
          },
        ],
      },
    ],
  },
}
