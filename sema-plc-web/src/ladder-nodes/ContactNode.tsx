/**
 * Contact Node Component
 *
 * Represents NO (Normally Open) and NC (Normally Closed) contacts in ladder logic.
 * Contacts check the state of a boolean variable.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { ContactNodeData } from '../models/ladder-elements';

import './LadderNodes.css';

export const ContactNode = memo(function ContactNode({
  data,
  selected,
}: NodeProps<Node<ContactNodeData>>) {
  const { variable, contactType } = data;
  const energized = data.live?.active === true;

  // Determine symbol based on contact type
  const getSymbol = () => {
    switch (contactType) {
      case 'NC':
        return '/'; // Normally Closed - diagonal line
      case 'P':
        return 'P'; // Positive edge
      case 'N':
        return 'N'; // Negative edge
      default:
        return ''; // NO - empty
    }
  };

  return (
    <div
      className={`ladder-node contact-node ${contactType.toLowerCase()} ${
        energized ? 'energized' : ''
      } ${selected ? 'selected' : ''}`}
    >
      {/* Input handle (left side - receives power) */}
      <Handle
        type="target"
        position={Position.Left}
        id="power-in"
        className="ladder-handle"
      />

      {/* Contact symbol */}
      <div className="contact-body">
        <div className="contact-rail left" />
        <div className="contact-center">
          <span className="contact-symbol">{getSymbol()}</span>
        </div>
        <div className="contact-rail right" />
      </div>

      {/* Variable name */}
      <div className="node-label">{variable || '???'}</div>

      {/* Output handle (right side - passes power if condition met) */}
      <Handle
        type="source"
        position={Position.Right}
        id="power-out"
        className="ladder-handle"
      />
    </div>
  );
});
