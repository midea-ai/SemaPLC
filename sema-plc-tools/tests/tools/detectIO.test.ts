import { describe, it, expect } from 'vitest'
import { detectIO, findUnassignedOutputs } from '../../src/tools/detectIO.js'

const HEARTBEAT = `PROGRAM heartbeat
  VAR
    hb_out AT %QX0.0 : BOOL;
  END_VAR
  VAR
    timer : TON;
  END_VAR
  timer(IN := NOT timer.Q, PT := T#1s);
  hb_out := timer.Q;
END_PROGRAM`

const BUTTON_COUNTER = `PROGRAM button_counter
  VAR
    trigger AT %IX0.0 : BOOL;
    count_out AT %QW0 : INT;
  END_VAR
  VAR
    btn_sim : BOOL;
    rtrig : R_TRIG;
    counter : CTU;
  END_VAR
  count_out := counter.CV;
END_PROGRAM`

const TRAFFIC_LIGHT = `PROGRAM traffic_light
  VAR
    red_led AT %QX0.0 : BOOL;
    green_led AT %QX0.1 : BOOL;
    yellow_led AT %QX0.2 : BOOL;
  END_VAR
  VAR
    state : INT;
  END_VAR
END_PROGRAM`

describe('detectIO', () => {
  it('detects a single BOOL output as a coil at address 0', () => {
    const r = detectIO(HEARTBEAT)
    expect(r.count).toBe(1)
    expect(r.io[0]).toEqual({
      name: 'hb_out',
      address: '%QX0.0',
      type: 'BOOL',
      direction: 'output',
      modbusType: 'coil',
      modbusAddr: 0,
    })
  })

  it('maps %IX to discrete_input and %QW to holding_register', () => {
    const r = detectIO(BUTTON_COUNTER)
    expect(r.count).toBe(2)
    expect(r.io).toEqual([
      { name: 'trigger', address: '%IX0.0', type: 'BOOL', direction: 'input', modbusType: 'discrete_input', modbusAddr: 0 },
      { name: 'count_out', address: '%QW0', type: 'INT', direction: 'output', modbusType: 'holding_register', modbusAddr: 0 },
    ])
  })

  it('numbers consecutive bits within a byte (0.0/0.1/0.2 → coil 0/1/2)', () => {
    const r = detectIO(TRAFFIC_LIGHT)
    expect(r.io.map(io => io.modbusAddr)).toEqual([0, 1, 2])
    expect(r.io.every(io => io.modbusType === 'coil')).toBe(true)
  })

  it('computes bit address across byte boundaries: byte*8 + bit', () => {
    const r = detectIO('VAR a AT %IX1.0 : BOOL; b AT %QX2.3 : BOOL; END_VAR')
    expect(r.io[0].modbusAddr).toBe(8)   // 1*8 + 0
    expect(r.io[1].modbusAddr).toBe(19)  // 2*8 + 3
  })

  it('maps %IW to input_register with the word number as address', () => {
    const r = detectIO('VAR s AT %IW5 : INT; END_VAR')
    expect(r.io[0]).toMatchObject({ direction: 'input', modbusType: 'input_register', modbusAddr: 5 })
  })

  it('lists unmapped address classes (e.g. %MW memory) with null modbus mapping', () => {
    const r = detectIO('VAR m AT %MW0 : INT; END_VAR')
    expect(r.io[0]).toMatchObject({ name: 'm', direction: 'memory', modbusType: null, modbusAddr: null })
  })

  it('ignores non-located variables (no AT clause)', () => {
    const r = detectIO('VAR timer : TON; state : INT; END_VAR')
    expect(r.count).toBe(0)
    expect(r.io).toEqual([])
  })

  it('returns an empty result for code with no IO', () => {
    expect(detectIO('')).toEqual({ io: [], count: 0 })
  })
})

describe('findUnassignedOutputs (P0b dead-output detection)', () => {
  it('flags a declared %Q output that the body never assigns', () => {
    const ST = `PROGRAM p
      VAR conveyor_run AT %QX0.0 : BOOL; lamp AT %QX0.1 : BOOL; END_VAR
      lamp := TRUE;
    END_PROGRAM`
    expect(findUnassignedOutputs(ST)).toEqual(['conveyor_run'])
  })

  it('returns [] when every output is assigned somewhere', () => {
    const ST = `PROGRAM p
      VAR a AT %QX0.0 : BOOL; pos AT %QW0 : INT; END_VAR
      a := TRUE;
      pos := pos + 1;
    END_PROGRAM`
    expect(findUnassignedOutputs(ST)).toEqual([])
  })

  it('does not flag inputs or memory variables — only %Q outputs', () => {
    const ST = `PROGRAM p
      VAR btn AT %IX0.0 : BOOL; flag AT %MX0.0 : BOOL; out AT %QX0.0 : BOOL; END_VAR
      out := btn;
    END_PROGRAM`
    expect(findUnassignedOutputs(ST)).toEqual([])
  })

  it('is case-insensitive (IEC identifiers) and ignores := inside comments', () => {
    // Assignment uses a different case; a commented-out := must NOT count.
    const ST = `PROGRAM p
      VAR Motor_On AT %QX0.0 : BOOL; ghost AT %QX0.1 : BOOL; END_VAR
      (* ghost := TRUE; *)
      MOTOR_ON := TRUE;
    END_PROGRAM`
    expect(findUnassignedOutputs(ST)).toEqual(['ghost'])
  })

  it('does not partial-match a longer identifier (belt_pos vs belt_pos2)', () => {
    const ST = `PROGRAM p
      VAR belt_pos AT %QW0 : INT; END_VAR
      belt_pos2 := 5;
    END_PROGRAM`
    expect(findUnassignedOutputs(ST)).toEqual(['belt_pos'])
  })
})
