import type { DetectedIO, ModbusType, ModbusSlaveConfig, ModbusSlaveConfigOptions } from '../types.js'

// Highest Modbus address among entries of a given type, +1 (the count needed to
// cover them); 0 if no entry maps to that type. Entries with no Modbus mapping
// (memory %M*, byte/dword forms) are ignored.
function sizeFor(io: DetectedIO[], type: ModbusType): number {
  let max = -1
  for (const e of io) {
    if (e.modbusType === type && e.modbusAddr != null && e.modbusAddr > max) max = e.modbusAddr
  }
  return max + 1
}

/**
 * Build the OpenPLC modbus_slave plugin config from detected located-IO.
 * Sizes each Modbus block to exactly cover the detected addresses. Dropping this
 * as `conf/modbus_slave.json` into a program ZIP makes OpenPLC auto-enable the
 * Modbus TCP slave on upload (verified: §12 Phase 0), so FUXA can read the
 * running program's %QX/%QW over Modbus.
 */
export function buildModbusSlaveConfig(io: DetectedIO[], opts: ModbusSlaveConfigOptions = {}): ModbusSlaveConfig {
  return {
    network_configuration: {
      host: opts.host ?? '0.0.0.0',
      port: opts.port ?? 502,
    },
    buffer_mapping: {
      coils: { qx_bits: sizeFor(io, 'coil') },
      discrete_inputs: { ix_bits: sizeFor(io, 'discrete_input') },
      holding_registers: { qw_count: sizeFor(io, 'holding_register') },
      input_registers: { iw_count: sizeFor(io, 'input_register') },
    },
  }
}
