/**
 * Counter Node Component
 *
 * Represents IEC 61131-3 counter function blocks: CTU, CTD, CTUD.
 * - CTU: Count up (QU goes TRUE when CV >= PV)
 * - CTD: Count down (QD goes TRUE when CV <= 0)
 * - CTUD: Count up/down (both QU and QD outputs)
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { CounterNodeData } from '../models/ladder-elements';

import './LadderNodes.css';

export const CounterNode = memo(function CounterNode({
  data,
  selected,
}: NodeProps<Node<CounterNodeData>>) {
  const { instanceName, counterType, presetValue } = data;

  // CTUD has both count up and count down inputs
  const isCTUD = counterType === 'CTUD';
  const isCTD = counterType === 'CTD';

  // Live current value (CV) + output state from the runtime overlay.
  const live = data.live;
  const energized = live?.active === true;
  const cv = typeof live?.value === 'number' ? live.value : null;

  return (
    <div
      className={`ladder-node counter-node ${counterType.toLowerCase()} ${
        energized ? 'energized' : ''
      } ${selected ? 'selected' : ''}`}
    >
      {/* Input handles (left side) */}
      {/* Main power input - use 'power-in' for compatibility with layout */}
      <Handle
        type="target"
        position={Position.Left}
        id="power-in"
        className="ladder-handle counter-handle"
        style={{ top: '25%' }}
      />
      {/* CD - Count Down input (CTD and CTUD) - additional handle */}
      {(isCTD || isCTUD) && (
        <Handle
          type="target"
          position={Position.Left}
          id="CD"
          className="ladder-handle counter-handle"
          style={{ top: isCTUD ? '40%' : '25%' }}
        />
      )}
      {/* R - Reset input */}
      <Handle
        type="target"
        position={Position.Left}
        id="R"
        className="ladder-handle counter-handle"
        style={{ top: isCTUD ? '55%' : '50%' }}
      />
      {/* PV - Preset Value input */}
      <Handle
        type="target"
        position={Position.Left}
        id="PV"
        className="ladder-handle counter-handle"
        style={{ top: isCTUD ? '70%' : '75%' }}
      />

      {/* Counter block body */}
      <div className="counter-body">
        <div className="counter-header">{counterType}</div>
        <div className="counter-instance">{instanceName || 'Counter'}</div>
        <div className="counter-params">
          {!isCTD && (
            <div className="counter-row">
              <span className="counter-pin-label">CU</span>
              <span className="counter-pin-label right">QU</span>
            </div>
          )}
          {(isCTD || isCTUD) && (
            <div className="counter-row">
              <span className="counter-pin-label">CD</span>
              <span className="counter-pin-label right">QD</span>
            </div>
          )}
          <div className="counter-row">
            <span className="counter-pin-label">R</span>
            {cv != null && <span className="counter-value active">{cv}</span>}
            <span className="counter-pin-label right">CV</span>
          </div>
          <div className="counter-row">
            <span className="counter-pin-label">PV</span>
          </div>
        </div>
        <div className="counter-preset">PV: {presetValue}</div>
      </div>

      {/* Output handles (right side) */}
      {/* Main power output - use 'power-out' for compatibility with layout */}
      <Handle
        type="source"
        position={Position.Right}
        id="power-out"
        className="ladder-handle counter-handle"
        style={{ top: '25%' }}
      />
      {/* QD - Count Down output (CTD and CTUD) - additional handle */}
      {(isCTD || isCTUD) && (
        <Handle
          type="source"
          position={Position.Right}
          id="QD"
          className="ladder-handle counter-handle"
          style={{ top: isCTUD ? '40%' : '25%' }}
        />
      )}
      {/* CV - Current Value output */}
      <Handle
        type="source"
        position={Position.Right}
        id="CV"
        className="ladder-handle counter-handle"
        style={{ top: isCTUD ? '55%' : '50%' }}
      />
    </div>
  );
});
