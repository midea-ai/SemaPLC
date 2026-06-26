/**
 * Coil Node Component
 *
 * Represents output coils in ladder logic.
 * Coils set the state of a boolean variable based on power flow.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { CoilNodeData } from '../models/ladder-elements';

import './LadderNodes.css';

export const CoilNode = memo(function CoilNode({
  data,
  selected,
}: NodeProps<Node<CoilNodeData>>) {
  const { variable, coilType } = data;
  const energized = data.live?.active === true;

  // Determine symbol based on coil type
  const getSymbol = () => {
    switch (coilType) {
      case 'set':
        return 'S'; // Set (latch)
      case 'reset':
        return 'R'; // Reset
      case 'positive':
        return 'P'; // Positive transition
      case 'negative':
        return 'N'; // Negative transition
      default:
        return ''; // Standard coil
    }
  };

  return (
    <div
      className={`ladder-node coil-node ${coilType} ${energized ? 'energized' : ''} ${selected ? 'selected' : ''}`}
    >
      {/* Input handle (left side - receives power) */}
      <Handle
        type="target"
        position={Position.Left}
        id="power-in"
        className="ladder-handle"
      />

      {/* Coil symbol - parentheses shape */}
      <div className="coil-body">
        <div className="coil-left">(</div>
        <div className="coil-center">
          <span className="coil-symbol">{getSymbol()}</span>
        </div>
        <div className="coil-right">)</div>
      </div>

      {/* Variable name */}
      <div className="node-label">{variable || '???'}</div>

      {/* Output handle (right side - to power rail) */}
      <Handle
        type="source"
        position={Position.Right}
        id="power-out"
        className="ladder-handle"
      />
    </div>
  );
});
