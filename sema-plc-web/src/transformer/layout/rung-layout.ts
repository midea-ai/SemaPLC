/**
 * Rung Layout Algorithm
 *
 * Positions nodes within a single rung of the ladder diagram.
 * Series elements are placed horizontally, parallel branches vertically.
 */

import type {
  ContactNetwork,
  SeriesNetwork,
  ParallelNetwork,
  ContactElement,
  ComparatorElement,
  LadderRungIR,
  RungOutput,
  TimerOutput,
  CounterOutput,
  CoilOutput,
} from '../ladder-ir';

// ============================================================================
// Layout Constants
// ============================================================================

export const CONTACT_WIDTH = 80;
export const CONTACT_HEIGHT = 60;
export const COIL_WIDTH = 80;
export const COIL_HEIGHT = 60;
export const TIMER_WIDTH = 120;
export const TIMER_HEIGHT = 100;
export const COUNTER_WIDTH = 120;
export const COUNTER_HEIGHT = 120;
export const COMPARATOR_WIDTH = 100;
export const COMPARATOR_HEIGHT = 60;
export const RAIL_WIDTH = 30;
export const HORIZONTAL_GAP = 30;
export const VERTICAL_GAP = 20;
export const RUNG_VERTICAL_GAP = 40;

// ============================================================================
// Layout Types
// ============================================================================

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: LayoutNodeData;
}

export type LayoutNodeData =
  | ContactLayoutData
  | CoilLayoutData
  | TimerLayoutData
  | CounterLayoutData
  | ComparatorLayoutData
  | PowerRailLayoutData;

export interface ContactLayoutData {
  type: 'contact';
  variable: string;
  contactType: 'NO' | 'NC' | 'P' | 'N';
  rungIndex: number;
}

export interface CoilLayoutData {
  type: 'coil';
  variable: string;
  coilType: 'standard' | 'set' | 'reset';
  rungIndex: number;
}

export interface TimerLayoutData {
  type: 'timer';
  instanceName: string;
  timerType: 'TON' | 'TOF' | 'TP';
  presetTime: string;
  rungIndex: number;
}

export interface CounterLayoutData {
  type: 'counter';
  instanceName: string;
  counterType: 'CTU' | 'CTD' | 'CTUD';
  presetValue: number;
  rungIndex: number;
}

export interface ComparatorLayoutData {
  type: 'comparator';
  operator: string;
  leftOperand: string;
  rightOperand: string;
  rungIndex: number;
}

export interface PowerRailLayoutData {
  type: 'powerRail';
  railType: 'left' | 'right';
  rungIndex: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface RungLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// ============================================================================
// ID Generation
// ============================================================================

let nodeIdCounter = 0;

export function resetLayoutIdCounter(): void {
  nodeIdCounter = 0;
}

function generateNodeId(rungId: string): string {
  return `${rungId}_node_${nodeIdCounter++}`;
}

// ============================================================================
// Main Layout Function
// ============================================================================

export function layoutRung(rung: LadderRungIR, baseY: number): RungLayout {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const rungId = rung.id;

  // Create left power rail
  const leftRailId = generateNodeId(rungId);
  const leftRail: LayoutNode = {
    id: leftRailId,
    x: 0,
    y: baseY,
    width: RAIL_WIDTH,
    height: CONTACT_HEIGHT,
    data: { type: 'powerRail', railType: 'left', rungIndex: rung.index },
  };
  nodes.push(leftRail);

  // Layout the input network (contacts)
  const networkStartX = RAIL_WIDTH + HORIZONTAL_GAP;
  const networkResult = layoutContactNetwork(
    rung.inputNetwork,
    networkStartX,
    baseY,
    rungId,
    rung.index
  );

  nodes.push(...networkResult.nodes);
  edges.push(...networkResult.edges);

  // Connect left rail to first node(s) of the network
  for (const firstId of networkResult.firstNodeIds) {
    edges.push({
      id: `${leftRailId}-${firstId}`,
      source: leftRailId,
      sourceHandle: 'power-out',
      target: firstId,
      targetHandle: 'power-in',
    });
  }

  // Layout the output (coil, timer, etc.)
  const outputStartX = networkStartX + networkResult.width + HORIZONTAL_GAP;
  const outputResult = layoutOutput(rung.output, outputStartX, baseY, rungId, rung.index);

  nodes.push(outputResult.node);

  // Connect last node(s) of network to output
  for (const lastId of networkResult.lastNodeIds) {
    edges.push({
      id: `${lastId}-${outputResult.node.id}`,
      source: lastId,
      sourceHandle: 'power-out',
      target: outputResult.node.id,
      targetHandle: 'power-in',
    });
  }

  // Create right power rail
  const rightRailX = outputStartX + outputResult.node.width + HORIZONTAL_GAP;
  const rightRailId = generateNodeId(rungId);
  const rightRail: LayoutNode = {
    id: rightRailId,
    x: rightRailX,
    y: baseY,
    width: RAIL_WIDTH,
    height: Math.max(networkResult.height, outputResult.node.height),
    data: { type: 'powerRail', railType: 'right', rungIndex: rung.index },
  };
  nodes.push(rightRail);

  // Connect output to right rail
  edges.push({
    id: `${outputResult.node.id}-${rightRailId}`,
    source: outputResult.node.id,
    sourceHandle: 'power-out',
    target: rightRailId,
    targetHandle: 'power-in',
  });

  // Calculate total dimensions
  const totalWidth = rightRailX + RAIL_WIDTH;
  const totalHeight = Math.max(networkResult.height, outputResult.node.height, CONTACT_HEIGHT);

  // Update left rail height to match
  leftRail.height = totalHeight;
  rightRail.height = totalHeight;

  return { nodes, edges, width: totalWidth, height: totalHeight };
}

// ============================================================================
// Contact Network Layout
// ============================================================================

interface NetworkLayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  firstNodeIds: string[];
  lastNodeIds: string[];
  width: number;
  height: number;
}

function layoutContactNetwork(
  network: ContactNetwork,
  startX: number,
  startY: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  switch (network.type) {
    case 'contact':
      return layoutSingleContact(network, startX, startY, rungId, rungIndex);
    case 'series':
      return layoutSeriesNetwork(network, startX, startY, rungId, rungIndex);
    case 'parallel':
      return layoutParallelNetwork(network, startX, startY, rungId, rungIndex);
    case 'comparator':
      return layoutComparator(network, startX, startY, rungId, rungIndex);
    case 'true':
      // True contact - create a pass-through (no visual element needed)
      // But for React Flow, we need at least one node to connect
      return layoutTrueContact(startX, startY, rungId, rungIndex);
  }
}

function layoutSingleContact(
  contact: ContactElement,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: CONTACT_WIDTH,
    height: CONTACT_HEIGHT,
    data: {
      type: 'contact',
      variable: contact.variable,
      contactType: contact.contactType,
      rungIndex,
    },
  };

  return {
    nodes: [node],
    edges: [],
    firstNodeIds: [id],
    lastNodeIds: [id],
    width: CONTACT_WIDTH,
    height: CONTACT_HEIGHT,
  };
}

function layoutSeriesNetwork(
  series: SeriesNetwork,
  startX: number,
  startY: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  if (series.elements.length === 0) {
    return layoutTrueContact(startX, startY, rungId, rungIndex);
  }

  const allNodes: LayoutNode[] = [];
  const allEdges: LayoutEdge[] = [];
  let currentX = startX;
  let maxHeight = 0;
  let prevLastIds: string[] = [];
  let firstNodeIds: string[] = [];

  for (let i = 0; i < series.elements.length; i++) {
    const element = series.elements[i];
    const result = layoutContactNetwork(element, currentX, startY, rungId, rungIndex);

    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);

    // Track first nodes (from the first element only)
    if (i === 0) {
      firstNodeIds = result.firstNodeIds;
    }

    // Connect previous last nodes to current first nodes
    if (prevLastIds.length > 0) {
      for (const prevId of prevLastIds) {
        for (const firstId of result.firstNodeIds) {
          allEdges.push({
            id: `${prevId}-${firstId}`,
            source: prevId,
            sourceHandle: 'power-out',
            target: firstId,
            targetHandle: 'power-in',
          });
        }
      }
    }

    prevLastIds = result.lastNodeIds;
    currentX += result.width + HORIZONTAL_GAP;
    maxHeight = Math.max(maxHeight, result.height);
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    firstNodeIds,
    lastNodeIds: prevLastIds,
    width: currentX - startX - HORIZONTAL_GAP,
    height: maxHeight,
  };
}

function layoutParallelNetwork(
  parallel: ParallelNetwork,
  startX: number,
  startY: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  if (parallel.branches.length === 0) {
    return layoutTrueContact(startX, startY, rungId, rungIndex);
  }

  const allNodes: LayoutNode[] = [];
  const allEdges: LayoutEdge[] = [];
  let currentY = startY;
  let maxWidth = 0;
  const allFirstIds: string[] = [];
  const allLastIds: string[] = [];

  for (const branch of parallel.branches) {
    const result = layoutContactNetwork(branch, startX, currentY, rungId, rungIndex);

    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);
    allFirstIds.push(...result.firstNodeIds);
    allLastIds.push(...result.lastNodeIds);

    maxWidth = Math.max(maxWidth, result.width);
    currentY += result.height + VERTICAL_GAP;
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    firstNodeIds: allFirstIds,
    lastNodeIds: allLastIds,
    width: maxWidth,
    height: currentY - startY - VERTICAL_GAP,
  };
}

function layoutComparator(
  comparator: ComparatorElement,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: COMPARATOR_WIDTH,
    height: COMPARATOR_HEIGHT,
    data: {
      type: 'comparator',
      operator: comparator.operator,
      leftOperand: comparator.leftOperand,
      rightOperand: comparator.rightOperand,
      rungIndex,
    },
  };

  return {
    nodes: [node],
    edges: [],
    firstNodeIds: [id],
    lastNodeIds: [id],
    width: COMPARATOR_WIDTH,
    height: COMPARATOR_HEIGHT,
  };
}

function layoutTrueContact(
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): NetworkLayoutResult {
  // Create a minimal "wire" node that just passes power through
  // This represents an always-true condition
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: HORIZONTAL_GAP, // Minimal width
    height: CONTACT_HEIGHT,
    data: {
      type: 'contact',
      variable: '',
      contactType: 'NO',
      rungIndex,
    },
  };

  // Mark this as a "wire" by setting variable to empty
  // The rendering layer can handle this specially

  return {
    nodes: [node],
    edges: [],
    firstNodeIds: [id],
    lastNodeIds: [id],
    width: HORIZONTAL_GAP,
    height: CONTACT_HEIGHT,
  };
}

// ============================================================================
// Output Layout
// ============================================================================

interface OutputLayoutResult {
  node: LayoutNode;
}

function layoutOutput(
  output: RungOutput,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): OutputLayoutResult {
  switch (output.type) {
    case 'coil':
      return layoutCoil(output, x, y, rungId, rungIndex);
    case 'timer':
      return layoutTimer(output, x, y, rungId, rungIndex);
    case 'counter':
      return layoutCounter(output, x, y, rungId, rungIndex);
    case 'multi':
      // For multi-output, just layout the first one for now
      if (output.outputs.length > 0) {
        return layoutOutput(output.outputs[0], x, y, rungId, rungIndex);
      }
      return layoutCoil(
        { type: 'coil', variable: 'OUTPUT', coilType: 'standard' },
        x,
        y,
        rungId,
        rungIndex
      );
  }
}

function layoutCoil(
  coil: CoilOutput,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): OutputLayoutResult {
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: COIL_WIDTH,
    height: COIL_HEIGHT,
    data: {
      type: 'coil',
      variable: coil.variable,
      coilType: coil.coilType,
      rungIndex,
    },
  };

  return { node };
}

function layoutTimer(
  timer: TimerOutput,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): OutputLayoutResult {
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: TIMER_WIDTH,
    height: TIMER_HEIGHT,
    data: {
      type: 'timer',
      instanceName: timer.instanceName,
      timerType: timer.timerType,
      presetTime: timer.presetTime,
      rungIndex,
    },
  };

  return { node };
}

function layoutCounter(
  counter: CounterOutput,
  x: number,
  y: number,
  rungId: string,
  rungIndex: number
): OutputLayoutResult {
  const id = generateNodeId(rungId);
  const node: LayoutNode = {
    id,
    x,
    y,
    width: COUNTER_WIDTH,
    height: COUNTER_HEIGHT,
    data: {
      type: 'counter',
      instanceName: counter.instanceName,
      counterType: counter.counterType,
      presetValue: counter.presetValue,
      rungIndex,
    },
  };

  return { node };
}
