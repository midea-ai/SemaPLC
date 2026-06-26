/**
 * Ladder Logic Element Types
 *
 * Guiding Principle: Every output MUST be correctly and traceably linked to its inputs.
 * All coils (outputs) must have a clear, verifiable path back to their controlling contacts (inputs).
 */

import type { Node, Edge } from '@xyflow/react';
import type { VariableDeclaration } from './plc-types';

// ============================================================================
// Element Types
// ============================================================================

export type LadderElementType =
  | 'contact'
  | 'coil'
  | 'timer'
  | 'counter'
  | 'comparator'
  | 'branch'
  | 'powerRail';

// ============================================================================
// Base Element Data
// ============================================================================

export interface BaseLadderElementData extends Record<string, unknown> {
  id: string;
  elementType: LadderElementType;
  rungIndex: number;
  columnIndex: number;
  /** Runtime overlay injected by applyLiveValues() when the PLC is running. */
  live?: LiveNodeState;
}

/**
 * Live runtime state overlaid onto a ladder node for real-time coloring.
 * Absent (undefined) means no runtime value resolved for this node — i.e. the
 * PLC isn't running, or the node's variable isn't in the current value snapshot.
 */
export interface LiveNodeState {
  /** Conducting / energized state — drives the green highlight. */
  active: boolean;
  /** Value bound to the node: contact/coil boolean, timer ET (ms), counter CV. */
  value?: number | boolean | string;
}

// ============================================================================
// Contact Node
// ============================================================================

/** Contact types following IEC 61131-3 */
export type ContactType =
  | 'NO'  // Normally Open (closes when variable is TRUE)
  | 'NC'  // Normally Closed (opens when variable is TRUE)
  | 'P'   // Positive edge detection (TRUE for one scan on rising edge)
  | 'N';  // Negative edge detection (TRUE for one scan on falling edge)

export interface ContactNodeData extends BaseLadderElementData {
  elementType: 'contact';
  variable: string;
  contactType: ContactType;
  negated: boolean; // TRUE for NC contacts
}

// ============================================================================
// Coil Node (Output)
// ============================================================================

/** Coil types following IEC 61131-3 */
export type CoilType =
  | 'standard'  // Normal output coil
  | 'set'       // Set (latch) coil - sets variable TRUE
  | 'reset'     // Reset coil - sets variable FALSE
  | 'positive'  // Positive transition coil
  | 'negative'; // Negative transition coil

export interface CoilNodeData extends BaseLadderElementData {
  elementType: 'coil';
  variable: string;
  coilType: CoilType;
}

// ============================================================================
// Timer Node (Function Block)
// ============================================================================

/** Timer types following IEC 61131-3 */
export type TimerType =
  | 'TON'  // On-delay timer: Q goes TRUE after PT when IN is TRUE
  | 'TOF'  // Off-delay timer: Q stays TRUE for PT after IN goes FALSE
  | 'TP';  // Pulse timer: Q goes TRUE for PT duration when IN has rising edge

export interface TimerNodeData extends BaseLadderElementData {
  elementType: 'timer';
  instanceName: string;
  timerType: TimerType;
  presetTime: string; // e.g., "T#5s", "T#100ms"
  // Connection variables (optional - for wiring to other logic)
  inVariable?: string;
  qVariable?: string;
  etVariable?: string;
}

// ============================================================================
// Counter Node (Function Block)
// ============================================================================

/** Counter types following IEC 61131-3 */
export type CounterType =
  | 'CTU'   // Count up
  | 'CTD'   // Count down
  | 'CTUD'; // Count up/down

export interface CounterNodeData extends BaseLadderElementData {
  elementType: 'counter';
  instanceName: string;
  counterType: CounterType;
  presetValue: number;
  // Connection variables
  cuVariable?: string;  // Count up input
  cdVariable?: string;  // Count down input
  resetVariable?: string;
  loadVariable?: string;
  qVariable?: string;
  cvVariable?: string;  // Current value
}

// ============================================================================
// Comparator Node
// ============================================================================

export type ComparatorOp =
  | 'EQ'  // Equal (=)
  | 'NE'  // Not Equal (<>)
  | 'GT'  // Greater Than (>)
  | 'GE'  // Greater or Equal (>=)
  | 'LT'  // Less Than (<)
  | 'LE'; // Less or Equal (<=)

export interface ComparatorNodeData extends BaseLadderElementData {
  elementType: 'comparator';
  operator: ComparatorOp;
  leftOperand: string;
  rightOperand: string;
}

// ============================================================================
// Branch Node (Parallel Connection)
// ============================================================================

export interface BranchNodeData extends BaseLadderElementData {
  elementType: 'branch';
  branchType: 'open' | 'close';
  branchId: string; // Links open and close branches
}

// ============================================================================
// Power Rail Node
// ============================================================================

export interface PowerRailNodeData extends BaseLadderElementData {
  elementType: 'powerRail';
  railType: 'left' | 'right';
}

// ============================================================================
// Union Types
// ============================================================================

export type LadderNodeData =
  | ContactNodeData
  | CoilNodeData
  | TimerNodeData
  | CounterNodeData
  | ComparatorNodeData
  | BranchNodeData
  | PowerRailNodeData;

// React Flow node with ladder data
export type LadderNode = Node<LadderNodeData>;

// Edge data for power flow visualization
export interface LadderEdgeData extends Record<string, unknown> {
  powerFlow: boolean; // TRUE when power is flowing through this connection
}

export type LadderEdge = Edge<LadderEdgeData>;

// ============================================================================
// Rung Representation
// ============================================================================

export interface LadderRung {
  id: string;
  index: number;
  comment?: string;
  nodes: LadderNode[];
  edges: LadderEdge[];
}

// ============================================================================
// Complete Ladder Diagram
// ============================================================================

export interface LadderDiagram {
  id: string;
  name: string;
  version: string;
  rungs: LadderRung[];
  variables: VariableDeclaration[];
}

// ============================================================================
// Factory Functions
// ============================================================================

let nodeIdCounter = 0;

export function generateNodeId(): string {
  return `node_${++nodeIdCounter}_${Date.now()}`;
}

export function resetNodeIdCounter(): void {
  nodeIdCounter = 0;
}

export function createContact(
  variable: string,
  contactType: ContactType,
  rungIndex: number,
  columnIndex: number
): LadderNode {
  const id = generateNodeId();
  return {
    id,
    type: 'contact',
    position: { x: columnIndex * 150, y: rungIndex * 100 },
    data: {
      id,
      elementType: 'contact',
      variable,
      contactType,
      negated: contactType === 'NC',
      rungIndex,
      columnIndex,
    },
  };
}

export function createCoil(
  variable: string,
  coilType: CoilType,
  rungIndex: number,
  columnIndex: number
): LadderNode {
  const id = generateNodeId();
  return {
    id,
    type: 'coil',
    position: { x: columnIndex * 150, y: rungIndex * 100 },
    data: {
      id,
      elementType: 'coil',
      variable,
      coilType,
      rungIndex,
      columnIndex,
    },
  };
}

export function createTimer(
  instanceName: string,
  timerType: TimerType,
  presetTime: string,
  rungIndex: number,
  columnIndex: number
): LadderNode {
  const id = generateNodeId();
  return {
    id,
    type: 'timer',
    position: { x: columnIndex * 150, y: rungIndex * 100 },
    data: {
      id,
      elementType: 'timer',
      instanceName,
      timerType,
      presetTime,
      rungIndex,
      columnIndex,
    },
  };
}

export function createCounter(
  instanceName: string,
  counterType: CounterType,
  presetValue: number,
  rungIndex: number,
  columnIndex: number
): LadderNode {
  const id = generateNodeId();
  return {
    id,
    type: 'counter',
    position: { x: columnIndex * 150, y: rungIndex * 100 },
    data: {
      id,
      elementType: 'counter',
      instanceName,
      counterType,
      presetValue,
      rungIndex,
      columnIndex,
    },
  };
}

export function createPowerRail(
  railType: 'left' | 'right',
  rungIndex: number,
  columnIndex: number
): LadderNode {
  const id = generateNodeId();
  return {
    id,
    type: 'powerRail',
    position: { x: columnIndex * 150, y: rungIndex * 100 },
    data: {
      id,
      elementType: 'powerRail',
      railType,
      rungIndex,
      columnIndex,
    },
  };
}

export function createEdge(
  sourceId: string,
  targetId: string,
  sourceHandle?: string,
  targetHandle?: string
): LadderEdge {
  return {
    id: `${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    sourceHandle,
    targetHandle,
    data: { powerFlow: false },
  };
}
