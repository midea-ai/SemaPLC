/**
 * Ladder Intermediate Representation (IR) Types
 *
 * The Ladder IR is an intermediate representation between the ST AST and the
 * final React Flow nodes/edges. It represents the logical structure of the
 * ladder diagram before layout is applied.
 *
 * Key concepts:
 * - ContactNetwork: Represents boolean logic as series/parallel contacts
 * - RungOutput: The output side of a rung (coil, timer, counter)
 * - LadderRungIR: A complete rung with input network and output
 */

import type { STStatement, STExpression, VariableScopeKind } from '../ast';

// ============================================================================
// Variable Information
// ============================================================================

export interface VariableInfo {
  name: string;
  dataType: string;
  scope: VariableScopeKind;
  usages: VariableUsage[];
}

export interface VariableUsage {
  rungIndex: number;
  role: 'input' | 'output' | 'internal';
  nodeId?: string;
}

// ============================================================================
// Function Block Information
// ============================================================================

export type FunctionBlockType = 'TON' | 'TOF' | 'TP' | 'CTU' | 'CTD' | 'CTUD';

export interface FunctionBlockInfo {
  name: string;
  type: FunctionBlockType;
  rungIndex: number;
  presetValue?: string; // PT for timers, PV for counters
}

// ============================================================================
// Contact Network (Input Side)
// ============================================================================

/**
 * ContactNetwork represents the input logic of a rung.
 * It's a recursive structure that can represent series, parallel, or single contacts.
 */
export type ContactNetwork =
  | SeriesNetwork
  | ParallelNetwork
  | ContactElement
  | ComparatorElement
  | TrueContact;

export interface SeriesNetwork {
  type: 'series';
  elements: ContactNetwork[];
}

export interface ParallelNetwork {
  type: 'parallel';
  branches: ContactNetwork[];
}

export type ContactType = 'NO' | 'NC' | 'P' | 'N';

export interface ContactElement {
  type: 'contact';
  variable: string;
  contactType: ContactType;
  /** Reference back to source AST for roundtrip */
  sourceExpr?: STExpression;
}

export type ComparatorOp = 'EQ' | 'NE' | 'GT' | 'GE' | 'LT' | 'LE';

export interface ComparatorElement {
  type: 'comparator';
  operator: ComparatorOp;
  leftOperand: string;
  rightOperand: string;
  sourceExpr?: STExpression;
}

/**
 * Represents an always-true condition (used when there's no input condition)
 */
export interface TrueContact {
  type: 'true';
}

// ============================================================================
// Rung Outputs
// ============================================================================

export type RungOutput =
  | CoilOutput
  | TimerOutput
  | CounterOutput
  | MultiBranchOutput;

export interface CoilOutput {
  type: 'coil';
  variable: string;
  coilType: 'standard' | 'set' | 'reset';
}

export type TimerType = 'TON' | 'TOF' | 'TP';

export interface TimerOutput {
  type: 'timer';
  instanceName: string;
  timerType: TimerType;
  presetTime: string; // e.g., "T#5s"
  /** The input network that drives the timer's IN pin */
  inputNetwork: ContactNetwork;
}

export type CounterType = 'CTU' | 'CTD' | 'CTUD';

export interface CounterOutput {
  type: 'counter';
  instanceName: string;
  counterType: CounterType;
  presetValue: number;
  /** The input network that drives the counter's CU/CD pin */
  inputNetwork: ContactNetwork;
}

/**
 * Multiple outputs from the same input condition
 * (e.g., one condition driving multiple coils)
 */
export interface MultiBranchOutput {
  type: 'multi';
  outputs: RungOutput[];
}

// ============================================================================
// Rung Representation
// ============================================================================

export interface LadderRungIR {
  id: string;
  index: number;
  comment?: string;
  /** Reference to the source ST statement for roundtrip */
  sourceStatement: STStatement;
  /** The input logic (contacts, comparators) */
  inputNetwork: ContactNetwork;
  /** The output (coil, timer, counter) */
  output: RungOutput;
}

// ============================================================================
// Complete Ladder IR
// ============================================================================

export interface LadderIR {
  programName: string;
  rungs: LadderRungIR[];
  variables: Map<string, VariableInfo>;
  functionBlocks: Map<string, FunctionBlockInfo>;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isSeriesNetwork(network: ContactNetwork): network is SeriesNetwork {
  return network.type === 'series';
}

export function isParallelNetwork(network: ContactNetwork): network is ParallelNetwork {
  return network.type === 'parallel';
}

export function isContactElement(network: ContactNetwork): network is ContactElement {
  return network.type === 'contact';
}

export function isComparatorElement(network: ContactNetwork): network is ComparatorElement {
  return network.type === 'comparator';
}

export function isTrueContact(network: ContactNetwork): network is TrueContact {
  return network.type === 'true';
}

export function isCoilOutput(output: RungOutput): output is CoilOutput {
  return output.type === 'coil';
}

export function isTimerOutput(output: RungOutput): output is TimerOutput {
  return output.type === 'timer';
}

export function isCounterOutput(output: RungOutput): output is CounterOutput {
  return output.type === 'counter';
}

export function isMultiBranchOutput(output: RungOutput): output is MultiBranchOutput {
  return output.type === 'multi';
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createContact(
  variable: string,
  contactType: ContactType = 'NO',
  sourceExpr?: STExpression
): ContactElement {
  return { type: 'contact', variable, contactType, sourceExpr };
}

export function createSeries(elements: ContactNetwork[]): SeriesNetwork {
  return { type: 'series', elements };
}

export function createParallel(branches: ContactNetwork[]): ParallelNetwork {
  return { type: 'parallel', branches };
}

export function createComparator(
  operator: ComparatorOp,
  leftOperand: string,
  rightOperand: string,
  sourceExpr?: STExpression
): ComparatorElement {
  return { type: 'comparator', operator, leftOperand, rightOperand, sourceExpr };
}

export function createCoil(
  variable: string,
  coilType: 'standard' | 'set' | 'reset' = 'standard'
): CoilOutput {
  return { type: 'coil', variable, coilType };
}

export function createTimerOutput(
  instanceName: string,
  timerType: TimerType,
  presetTime: string,
  inputNetwork: ContactNetwork
): TimerOutput {
  return { type: 'timer', instanceName, timerType, presetTime, inputNetwork };
}

export function createCounterOutput(
  instanceName: string,
  counterType: CounterType,
  presetValue: number,
  inputNetwork: ContactNetwork
): CounterOutput {
  return { type: 'counter', instanceName, counterType, presetValue, inputNetwork };
}

export function createRung(
  id: string,
  index: number,
  sourceStatement: STStatement,
  inputNetwork: ContactNetwork,
  output: RungOutput,
  comment?: string
): LadderRungIR {
  return { id, index, sourceStatement, inputNetwork, output, comment };
}

export function createLadderIR(programName: string): LadderIR {
  return {
    programName,
    rungs: [],
    variables: new Map(),
    functionBlocks: new Map(),
  };
}
