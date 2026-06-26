/**
 * Ladder IR to React Flow Conversion
 *
 * Converts the layout result into React Flow compatible nodes and edges
 * that can be directly used with the LadderCanvas component.
 */

import type { LadderNode, LadderEdge, LadderNodeData } from '../../models/ladder-elements';
import type { LadderIR } from '../ladder-ir';
import type {
  DiagramLayout,
  LayoutNode,
  LayoutEdge,
} from '../layout';

// ============================================================================
// Main Conversion Function
// ============================================================================

export interface ReactFlowResult {
  nodes: LadderNode[];
  edges: LadderEdge[];
}

export function irToReactFlow(
  _ir: LadderIR,
  layout: DiagramLayout
): ReactFlowResult {
  const nodes = layout.nodes.map(layoutNode => convertLayoutNode(layoutNode));
  const edges = layout.edges.map(layoutEdge => convertLayoutEdge(layoutEdge));

  return { nodes, edges };
}

// ============================================================================
// Node Conversion
// ============================================================================

function convertLayoutNode(layoutNode: LayoutNode): LadderNode {
  const { id, x, y, data } = layoutNode;

  // Determine the React Flow node type based on the data type
  const nodeType = getNodeType(data);

  // Convert the layout data to ladder element data
  const nodeData = convertNodeData(layoutNode);

  return {
    id,
    type: nodeType,
    position: { x, y },
    data: nodeData,
  };
}

function getNodeType(data: LayoutNode['data']): string {
  switch (data.type) {
    case 'contact':
      return 'contact';
    case 'coil':
      return 'coil';
    case 'timer':
      return 'timer';
    case 'counter':
      return 'counter';
    case 'comparator':
      return 'comparator';
    case 'powerRail':
      return 'powerRail';
    default:
      return 'contact';
  }
}

function convertNodeData(layoutNode: LayoutNode): LadderNodeData {
  const { id, data } = layoutNode;
  const baseData = {
    id,
    rungIndex: data.rungIndex,
    columnIndex: 0, // Will be calculated if needed
  };

  switch (data.type) {
    case 'contact':
      return {
        ...baseData,
        elementType: 'contact',
        variable: data.variable,
        contactType: data.contactType,
        negated: data.contactType === 'NC',
      };

    case 'coil':
      return {
        ...baseData,
        elementType: 'coil',
        variable: data.variable,
        coilType: data.coilType,
      };

    case 'timer':
      return {
        ...baseData,
        elementType: 'timer',
        instanceName: data.instanceName,
        timerType: data.timerType,
        presetTime: data.presetTime,
      };

    case 'counter':
      return {
        ...baseData,
        elementType: 'counter',
        instanceName: data.instanceName,
        counterType: data.counterType,
        presetValue: data.presetValue,
      };

    case 'comparator':
      return {
        ...baseData,
        elementType: 'comparator',
        operator: mapComparatorOp(data.operator),
        leftOperand: data.leftOperand,
        rightOperand: data.rightOperand,
      };

    case 'powerRail':
      return {
        ...baseData,
        elementType: 'powerRail',
        railType: data.railType,
      };

    default:
      // Fallback to contact
      return {
        ...baseData,
        elementType: 'contact',
        variable: 'UNKNOWN',
        contactType: 'NO',
        negated: false,
      };
  }
}

function mapComparatorOp(op: string): 'EQ' | 'NE' | 'GT' | 'GE' | 'LT' | 'LE' {
  switch (op) {
    case 'EQ':
    case '=':
      return 'EQ';
    case 'NE':
    case '<>':
      return 'NE';
    case 'GT':
    case '>':
      return 'GT';
    case 'GE':
    case '>=':
      return 'GE';
    case 'LT':
    case '<':
      return 'LT';
    case 'LE':
    case '<=':
      return 'LE';
    default:
      return 'EQ';
  }
}

// ============================================================================
// Edge Conversion
// ============================================================================

function convertLayoutEdge(layoutEdge: LayoutEdge): LadderEdge {
  return {
    id: layoutEdge.id,
    source: layoutEdge.source,
    target: layoutEdge.target,
    sourceHandle: layoutEdge.sourceHandle,
    targetHandle: layoutEdge.targetHandle,
    data: { powerFlow: false },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Filter nodes by type
 */
export function getNodesByType(
  result: ReactFlowResult,
  type: string
): LadderNode[] {
  return result.nodes.filter(node => node.type === type);
}

/**
 * Get all contact nodes
 */
export function getContactNodes(result: ReactFlowResult): LadderNode[] {
  return getNodesByType(result, 'contact');
}

/**
 * Get all coil nodes
 */
export function getCoilNodes(result: ReactFlowResult): LadderNode[] {
  return getNodesByType(result, 'coil');
}

/**
 * Get all timer nodes
 */
export function getTimerNodes(result: ReactFlowResult): LadderNode[] {
  return getNodesByType(result, 'timer');
}

/**
 * Get edges connected to a specific node
 */
export function getEdgesForNode(
  result: ReactFlowResult,
  nodeId: string
): LadderEdge[] {
  return result.edges.filter(
    edge => edge.source === nodeId || edge.target === nodeId
  );
}

/**
 * Get incoming edges for a node
 */
export function getIncomingEdges(
  result: ReactFlowResult,
  nodeId: string
): LadderEdge[] {
  return result.edges.filter(edge => edge.target === nodeId);
}

/**
 * Get outgoing edges for a node
 */
export function getOutgoingEdges(
  result: ReactFlowResult,
  nodeId: string
): LadderEdge[] {
  return result.edges.filter(edge => edge.source === nodeId);
}

/**
 * Check if a node has any incoming connections
 */
export function hasIncomingConnections(
  result: ReactFlowResult,
  nodeId: string
): boolean {
  return result.edges.some(edge => edge.target === nodeId);
}

/**
 * Check if a node has any outgoing connections
 */
export function hasOutgoingConnections(
  result: ReactFlowResult,
  nodeId: string
): boolean {
  return result.edges.some(edge => edge.source === nodeId);
}
