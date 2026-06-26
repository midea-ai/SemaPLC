/**
 * Timer Node Component
 *
 * Represents IEC 61131-3 timer function blocks: TON, TOF, TP.
 * - TON: On-delay timer (Q goes TRUE after PT when IN is TRUE)
 * - TOF: Off-delay timer (Q stays TRUE for PT after IN goes FALSE)
 * - TP: Pulse timer (Q is TRUE for PT duration when IN rising edge)
 *
 * Live runtime state (Q / ET) arrives via data.live, injected by applyLiveValues()
 * from the plc:values snapshot while the PLC is running.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { TimerNodeData } from '../models/ladder-elements';

import './LadderNodes.css';

/**
 * Format milliseconds to a human-readable time string
 */
function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export const TimerNode = memo(function TimerNode({
  data,
  selected,
}: NodeProps<Node<TimerNodeData>>) {
  const { instanceName, timerType, presetTime } = data;

  // Live Q / ET from the runtime overlay (null when the PLC isn't running).
  const live = data.live;
  const q = live?.active === true;
  const et = typeof live?.value === 'number' ? live.value : null;

  return (
    <div
      className={`ladder-node timer-node ${timerType.toLowerCase()} ${
        q ? 'energized' : ''
      } ${selected ? 'selected' : ''}`}
    >
      {/* Input handles (left side) */}
      {/* Main power input - use 'power-in' for compatibility with layout */}
      <Handle
        type="target"
        position={Position.Left}
        id="power-in"
        className="ladder-handle timer-handle"
        style={{ top: '30%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="PT"
        className="ladder-handle timer-handle"
        style={{ top: '70%' }}
      />

      {/* Timer block body */}
      <div className="timer-body">
        <div className="timer-header">{timerType}</div>
        <div className="timer-instance">{instanceName || 'Timer'}</div>
        <div className="timer-params">
          <div className="timer-row">
            <span className="timer-pin-label">IN</span>
            <span className={`timer-value ${q ? 'active' : ''}`}>
              {q ? '1' : '0'}
            </span>
            <span className="timer-pin-label right">Q</span>
          </div>
          <div className="timer-row">
            <span className="timer-pin-label">PT</span>
            <span className="timer-value">
              {et != null ? formatTime(et) : '—'}
            </span>
            <span className="timer-pin-label right">ET</span>
          </div>
        </div>
        <div className="timer-preset">PT: {presetTime}</div>
      </div>

      {/* Output handles (right side) */}
      {/* Main power output - use 'power-out' for compatibility with layout */}
      <Handle
        type="source"
        position={Position.Right}
        id="power-out"
        className="ladder-handle timer-handle"
        style={{ top: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="ET"
        className="ladder-handle timer-handle"
        style={{ top: '70%' }}
      />
    </div>
  );
});
