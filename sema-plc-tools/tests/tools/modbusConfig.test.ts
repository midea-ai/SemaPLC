import { describe, it, expect } from 'vitest'
import { buildModbusSlaveConfig } from '../../src/tools/modbusConfig.js'
import { detectIO } from '../../src/tools/detectIO.js'
import type { DetectedIO } from '../../src/types.js'

const io = (over: Partial<DetectedIO>): DetectedIO => ({
  name: 'x', address: '%QX0.0', type: 'BOOL', direction: 'output',
  modbusType: 'coil', modbusAddr: 0, ...over,
})

describe('buildModbusSlaveConfig', () => {
  it('defaults to host 0.0.0.0 / port 502 (the schema validated against the live runtime)', () => {
    const cfg = buildModbusSlaveConfig([])
    expect(cfg.network_configuration).toEqual({ host: '0.0.0.0', port: 502 })
  })

  it('honors explicit host/port options', () => {
    const cfg = buildModbusSlaveConfig([], { host: '127.0.0.1', port: 5020 })
    expect(cfg.network_configuration).toEqual({ host: '127.0.0.1', port: 5020 })
  })

  it('sizes coil count to the highest %QX address + 1 (traffic_light: 3 coils)', () => {
    const cfg = buildModbusSlaveConfig([
      io({ name: 'red', modbusAddr: 0 }),
      io({ name: 'green', modbusAddr: 1 }),
      io({ name: 'yellow', modbusAddr: 2 }),
    ])
    expect(cfg.buffer_mapping.coils.qx_bits).toBe(3)
    expect(cfg.buffer_mapping.discrete_inputs.ix_bits).toBe(0)
    expect(cfg.buffer_mapping.holding_registers.qw_count).toBe(0)
    expect(cfg.buffer_mapping.input_registers.iw_count).toBe(0)
  })

  it('sizes each register/bit block independently (button_counter: 1 discrete in, 1 holding reg)', () => {
    const cfg = buildModbusSlaveConfig([
      io({ name: 'trigger', address: '%IX0.0', direction: 'input', modbusType: 'discrete_input', modbusAddr: 0 }),
      io({ name: 'count_out', address: '%QW0', direction: 'output', modbusType: 'holding_register', modbusAddr: 0 }),
    ])
    expect(cfg.buffer_mapping.discrete_inputs.ix_bits).toBe(1)
    expect(cfg.buffer_mapping.holding_registers.qw_count).toBe(1)
    expect(cfg.buffer_mapping.coils.qx_bits).toBe(0)
  })

  it('uses max+1 for sparse addresses (%IW5 → input_registers iw_count 6)', () => {
    const cfg = buildModbusSlaveConfig([
      io({ name: 's', address: '%IW5', direction: 'input', modbusType: 'input_register', modbusAddr: 5 }),
    ])
    expect(cfg.buffer_mapping.input_registers.iw_count).toBe(6)
  })

  it('ignores entries with no Modbus mapping (memory %MW)', () => {
    const cfg = buildModbusSlaveConfig([
      io({ name: 'm', address: '%MW0', direction: 'memory', modbusType: null, modbusAddr: null }),
    ])
    expect(cfg.buffer_mapping.holding_registers.qw_count).toBe(0)
  })

  it('end-to-end from detectIO on traffic_light gives 3 coils on port 502', () => {
    const TRAFFIC = `VAR red AT %QX0.0:BOOL; grn AT %QX0.1:BOOL; ylw AT %QX0.2:BOOL; END_VAR`
    const cfg = buildModbusSlaveConfig(detectIO(TRAFFIC).io)
    expect(cfg.buffer_mapping.coils.qx_bits).toBe(3)
    expect(cfg.network_configuration.port).toBe(502)
  })
})
