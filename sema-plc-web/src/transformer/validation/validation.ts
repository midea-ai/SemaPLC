/**
 * Ladder Diagram Validation Module
 *
 * Enforces the guiding principles:
 * 1. Every output MUST be correctly linked to its inputs (traceability)
 * 2. All variables must be declared
 * 3. Power flow must be complete from left rail to outputs
 *
 * This module is separate from the transformer to allow independent validation.
 */

import type {
  LadderIR,
  LadderRungIR,
  ContactNetwork,
  RungOutput,
  FunctionBlockInfo,
} from '../ladder-ir';

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export type ValidationErrorType =
  | 'orphaned_output'
  | 'dangling_input'
  | 'unconnected_node'
  | 'invalid_reference'
  | 'missing_input'
  | 'power_flow_break'
  | 'undeclared_variable';

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  rungIndex?: number;
  nodeId?: string;
  variable?: string;
}

export type ValidationWarningType =
  | 'unused_variable'
  | 'redundant_contact'
  | 'always_true'
  | 'always_false';

export interface ValidationWarning {
  type: ValidationWarningType;
  message: string;
  rungIndex?: number;
  variable?: string;
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate a Ladder IR for correctness.
 * Checks all guiding principles.
 */
export function validateLadderIR(ir: LadderIR): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Collect all variables used in the diagram
  const usedVariables = collectUsedVariables(ir);

  // 1. Validate output-input linkage
  const linkageResult = validateOutputInputLinkage(ir);
  errors.push(...linkageResult.errors);
  warnings.push(...linkageResult.warnings);

  // 2. Validate variable references
  const refResult = validateVariableReferences(ir, usedVariables);
  errors.push(...refResult.errors);
  warnings.push(...refResult.warnings);

  // 3. Validate power flow for each rung
  for (const rung of ir.rungs) {
    const flowResult = validatePowerFlow(rung);
    errors.push(...flowResult.errors);
    warnings.push(...flowResult.warnings);
  }

  // 4. Check for unused declared variables
  const unusedResult = checkUnusedVariables(ir, usedVariables);
  warnings.push(...unusedResult.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Output-Input Linkage Validation
// ============================================================================

/**
 * Validates that every output has connected inputs.
 * Enforces: "Every output MUST be correctly and traceably linked to its inputs."
 */
export function validateOutputInputLinkage(ir: LadderIR): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const rung of ir.rungs) {
    // Check if the output has an input network
    const hasValidInput = hasInputNetwork(rung.inputNetwork);

    if (!hasValidInput) {
      errors.push({
        type: 'orphaned_output',
        message: `Output in rung ${rung.index} has no input conditions`,
        rungIndex: rung.index,
        variable: getOutputVariable(rung.output),
      });
    }

    // Check if the input network is always true (just power rail)
    if (isAlwaysTrueNetwork(rung.inputNetwork)) {
      warnings.push({
        type: 'always_true',
        message: `Output in rung ${rung.index} is always energized (no conditional logic)`,
        rungIndex: rung.index,
        variable: getOutputVariable(rung.output),
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function hasInputNetwork(network: ContactNetwork): boolean {
  // A valid input network has at least one contact or comparator
  switch (network.type) {
    case 'contact':
      return network.variable !== '';
    case 'comparator':
      return true;
    case 'series':
      return network.elements.some(hasInputNetwork);
    case 'parallel':
      return network.branches.some(hasInputNetwork);
    case 'true':
      return false; // True contact means no real input
  }
}

function isAlwaysTrueNetwork(network: ContactNetwork): boolean {
  return network.type === 'true';
}

function getOutputVariable(output: RungOutput): string {
  switch (output.type) {
    case 'coil':
      return output.variable;
    case 'timer':
      return output.instanceName;
    case 'counter':
      return output.instanceName;
    case 'multi':
      return output.outputs.map(o => getOutputVariable(o)).join(', ');
  }
}

// ============================================================================
// Variable Reference Validation
// ============================================================================

/**
 * Validates that all referenced variables are declared.
 */
export function validateVariableReferences(
  ir: LadderIR,
  usedVariables: Set<string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const varName of usedVariables) {
    // Skip special variables
    if (isSpecialVariable(varName)) {
      continue;
    }

    // Check if variable is declared
    const isDeclared = ir.variables.has(varName) ||
      ir.functionBlocks.has(varName) ||
      isFunctionBlockOutput(varName, ir.functionBlocks);

    if (!isDeclared) {
      errors.push({
        type: 'undeclared_variable',
        message: `Variable "${varName}" is used but not declared`,
        variable: varName,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function isSpecialVariable(name: string): boolean {
  // TRUE and FALSE are built-in
  return name === 'TRUE' || name === 'FALSE' || name === '';
}

function isFunctionBlockOutput(varName: string, fbs: Map<string, FunctionBlockInfo>): boolean {
  // Check if varName is like "Timer1.Q" where Timer1 is a function block
  const parts = varName.split('.');
  if (parts.length === 2) {
    const [fbName, member] = parts;
    if (fbs.has(fbName)) {
      // Valid FB outputs
      const validOutputs = ['Q', 'ET', 'CV', 'QU', 'QD'];
      return validOutputs.includes(member);
    }
  }
  return false;
}

// ============================================================================
// Power Flow Validation
// ============================================================================

/**
 * Validates that power can flow from input to output in each rung.
 */
export function validatePowerFlow(rung: LadderRungIR): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check for empty input network
  if (!hasAnyNodes(rung.inputNetwork)) {
    // This is technically valid (direct power to output)
    // but might indicate a problem
    warnings.push({
      type: 'always_true',
      message: `Rung ${rung.index} has no input logic - output is always active`,
      rungIndex: rung.index,
    });
  }

  // Check for contradictory logic (A AND NOT A)
  const contradictions = findContradictions(rung.inputNetwork);
  for (const contradiction of contradictions) {
    warnings.push({
      type: 'always_false',
      message: `Rung ${rung.index} contains contradictory logic for variable "${contradiction}"`,
      rungIndex: rung.index,
      variable: contradiction,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function hasAnyNodes(network: ContactNetwork): boolean {
  switch (network.type) {
    case 'contact':
      return true;
    case 'comparator':
      return true;
    case 'series':
      return network.elements.length > 0;
    case 'parallel':
      return network.branches.length > 0;
    case 'true':
      return false;
  }
}

function findContradictions(network: ContactNetwork): string[] {
  // Collect all contacts in the network
  const contacts = collectContacts(network);

  // Group by variable
  const byVariable = new Map<string, { hasNO: boolean; hasNC: boolean }>();

  for (const contact of contacts) {
    if (!byVariable.has(contact.variable)) {
      byVariable.set(contact.variable, { hasNO: false, hasNC: false });
    }
    const entry = byVariable.get(contact.variable)!;
    if (contact.contactType === 'NO') {
      entry.hasNO = true;
    } else if (contact.contactType === 'NC') {
      entry.hasNC = true;
    }
  }

  // Find variables that have both NO and NC in series
  // This is a simplification - full analysis would need to consider topology
  const contradictions: string[] = [];
  for (const [variable, { hasNO, hasNC }] of byVariable) {
    if (hasNO && hasNC && isInSeries(network, variable)) {
      contradictions.push(variable);
    }
  }

  return contradictions;
}

interface ContactInfo {
  variable: string;
  contactType: 'NO' | 'NC' | 'P' | 'N';
}

function collectContacts(network: ContactNetwork): ContactInfo[] {
  const contacts: ContactInfo[] = [];

  switch (network.type) {
    case 'contact':
      contacts.push({
        variable: network.variable,
        contactType: network.contactType,
      });
      break;
    case 'series':
      for (const element of network.elements) {
        contacts.push(...collectContacts(element));
      }
      break;
    case 'parallel':
      for (const branch of network.branches) {
        contacts.push(...collectContacts(branch));
      }
      break;
    case 'comparator':
    case 'true':
      // No contacts
      break;
  }

  return contacts;
}

function isInSeries(network: ContactNetwork, variable: string): boolean {
  // Check if both NO and NC of the same variable are in series
  // This is a simplification
  if (network.type === 'series') {
    let foundNO = false;
    let foundNC = false;

    for (const element of network.elements) {
      if (element.type === 'contact' && element.variable === variable) {
        if (element.contactType === 'NO') foundNO = true;
        if (element.contactType === 'NC') foundNC = true;
      }
    }

    return foundNO && foundNC;
  }
  return false;
}

// ============================================================================
// Unused Variable Check
// ============================================================================

function checkUnusedVariables(
  ir: LadderIR,
  usedVariables: Set<string>
): { warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];

  for (const [varName, _info] of ir.variables) {
    if (!usedVariables.has(varName)) {
      warnings.push({
        type: 'unused_variable',
        message: `Variable "${varName}" is declared but never used`,
        variable: varName,
      });
    }
  }

  return { warnings };
}

// ============================================================================
// Variable Collection
// ============================================================================

function collectUsedVariables(ir: LadderIR): Set<string> {
  const variables = new Set<string>();

  for (const rung of ir.rungs) {
    collectVariablesFromNetwork(rung.inputNetwork, variables);
    collectVariablesFromOutput(rung.output, variables);
  }

  return variables;
}

function collectVariablesFromNetwork(network: ContactNetwork, variables: Set<string>): void {
  switch (network.type) {
    case 'contact':
      if (network.variable) {
        variables.add(network.variable);
      }
      break;
    case 'comparator':
      variables.add(network.leftOperand);
      variables.add(network.rightOperand);
      break;
    case 'series':
      for (const element of network.elements) {
        collectVariablesFromNetwork(element, variables);
      }
      break;
    case 'parallel':
      for (const branch of network.branches) {
        collectVariablesFromNetwork(branch, variables);
      }
      break;
    case 'true':
      // No variables
      break;
  }
}

function collectVariablesFromOutput(output: RungOutput, variables: Set<string>): void {
  switch (output.type) {
    case 'coil':
      variables.add(output.variable);
      break;
    case 'timer':
      variables.add(output.instanceName);
      break;
    case 'counter':
      variables.add(output.instanceName);
      break;
    case 'multi':
      for (const o of output.outputs) {
        collectVariablesFromOutput(o, variables);
      }
      break;
  }
}
