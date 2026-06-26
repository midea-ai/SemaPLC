/**
 * AST to Ladder IR Converter
 *
 * Transforms the ST AST into Ladder IR (intermediate representation).
 * This is the core transformation logic that converts:
 * - Boolean expressions -> Contact networks (series/parallel)
 * - Assignments -> Rungs with coils
 * - Function block calls -> Timer/counter blocks
 */

import type {
  STAST,
  STProgram,
  STVarBlock,
  STStatement,
  STAssignment,
  STFunctionBlockCall,
  STIfStatement,
  STCaseStatement,
  STExpression,
  STBinaryExpr,
  STUnaryExpr,
  STVariable,
  STLiteral,
  STFunctionCall,
  BinaryOperator,
} from '../ast';

import type {
  LadderIR,
  LadderRungIR,
  ContactNetwork,
  ContactElement,
  VariableInfo,
  FunctionBlockInfo,
  FunctionBlockType,
  ComparatorOp,
} from './ladder-ir-types';

import {
  createContact,
  createSeries,
  createParallel,
  createComparator,
  createCoil,
  createTimerOutput,
  createCounterOutput,
  createRung,
  createLadderIR,
} from './ladder-ir-types';

// ============================================================================
// Main Entry Point
// ============================================================================

export function astToLadderIR(ast: STAST): LadderIR {
  // If there are programs, process the first one
  if (ast.programs.length > 0) {
    return programToLadderIR(ast.programs[0]);
  }

  // Otherwise, process top-level statements
  const ir = createLadderIR('Main');

  // Collect variable declarations
  for (const varBlock of ast.topLevelVarBlocks) {
    collectVariables(varBlock, ir.variables, ir.functionBlocks);
  }

  // Convert statements to rungs
  for (const stmt of ast.topLevelStatements) {
    const rungs = statementToRungs(stmt, ir.rungs.length, ir.variables, ir.functionBlocks);
    ir.rungs.push(...rungs);
  }

  return ir;
}

function programToLadderIR(program: STProgram): LadderIR {
  const ir = createLadderIR(program.name);

  // First pass: collect variable and function block declarations
  for (const varBlock of program.varBlocks) {
    collectVariables(varBlock, ir.variables, ir.functionBlocks);
  }

  // Second pass: convert statements to rungs
  for (const stmt of program.statements) {
    const rungs = statementToRungs(stmt, ir.rungs.length, ir.variables, ir.functionBlocks);
    ir.rungs.push(...rungs);
  }

  return ir;
}

// ============================================================================
// Variable Collection
// ============================================================================

function collectVariables(
  varBlock: STVarBlock,
  variables: Map<string, VariableInfo>,
  functionBlocks: Map<string, FunctionBlockInfo>
): void {
  for (const decl of varBlock.declarations) {
    const typeName = decl.dataType.typeName.toUpperCase();

    // Check if this is a function block type
    if (isFunctionBlockType(typeName)) {
      for (const name of decl.names) {
        functionBlocks.set(name, {
          name,
          type: typeName as FunctionBlockType,
          rungIndex: -1, // Will be set when used
        });
      }
    } else {
      // Regular variable
      for (const name of decl.names) {
        variables.set(name, {
          name,
          dataType: typeName,
          scope: varBlock.scope,
          usages: [],
        });
      }
    }
  }
}

function isFunctionBlockType(typeName: string): boolean {
  return ['TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD'].includes(typeName);
}

// ============================================================================
// Statement to Rung Conversion
// ============================================================================

function statementToRungs(
  stmt: STStatement,
  baseIndex: number,
  variables: Map<string, VariableInfo>,
  functionBlocks: Map<string, FunctionBlockInfo>
): LadderRungIR[] {
  switch (stmt.type) {
    case 'Assignment':
      return [assignmentToRung(stmt, baseIndex)];
    case 'FunctionBlockCall':
      return [functionBlockCallToRung(stmt, baseIndex, functionBlocks)];
    case 'IfStatement':
      return ifStatementToRungs(stmt, baseIndex, variables, functionBlocks);
    case 'CaseStatement':
      return caseStatementToRungs(stmt, baseIndex, variables, functionBlocks);
    default:
      // Other statement types (FOR, WHILE, etc.) cannot be directly represented
      // Return empty array - they would need to be flagged as warnings
      return [];
  }
}

function assignmentToRung(stmt: STAssignment, index: number): LadderRungIR {
  const targetName = stmt.target.accessPath.join('.');

  // Convert the expression to a contact network
  const inputNetwork = expressionToContactNetwork(stmt.expression);

  // Create the coil output
  const output = createCoil(targetName, 'standard');

  return createRung(
    `rung_${index}`,
    index,
    stmt,
    inputNetwork,
    output
  );
}

function functionBlockCallToRung(
  stmt: STFunctionBlockCall,
  index: number,
  functionBlocks: Map<string, FunctionBlockInfo>
): LadderRungIR {
  const fbInfo = functionBlocks.get(stmt.instanceName);

  if (!fbInfo) {
    // Unknown function block - create a simple coil as fallback
    return createRung(
      `rung_${index}`,
      index,
      stmt,
      { type: 'true' },
      createCoil(stmt.instanceName, 'standard')
    );
  }

  // Update the rung index in fbInfo
  fbInfo.rungIndex = index;

  // Find the IN and PT/PV arguments
  const inArg = stmt.arguments.find(a => a.name.toUpperCase() === 'IN');
  const ptArg = stmt.arguments.find(a => a.name.toUpperCase() === 'PT');
  // pvArg would be used for counters: stmt.arguments.find(a => a.name.toUpperCase() === 'PV');

  // Build input network from IN argument
  const inputNetwork: ContactNetwork = inArg
    ? expressionToContactNetwork(inArg.expression)
    : { type: 'true' };

  // Handle timer types
  if (fbInfo.type === 'TON' || fbInfo.type === 'TOF' || fbInfo.type === 'TP') {
    const presetTime = ptArg ? expressionToString(ptArg.expression) : 'T#0s';
    return createRung(
      `rung_${index}`,
      index,
      stmt,
      inputNetwork,
      createTimerOutput(stmt.instanceName, fbInfo.type, presetTime, inputNetwork)
    );
  }

  // Handle counter types (CTU, CTD, CTUD)
  if (fbInfo.type === 'CTU' || fbInfo.type === 'CTD' || fbInfo.type === 'CTUD') {
    const pvArg = stmt.arguments.find(a => a.name.toUpperCase() === 'PV');
    const cuArg = stmt.arguments.find(a => a.name.toUpperCase() === 'CU');
    const cdArg = stmt.arguments.find(a => a.name.toUpperCase() === 'CD');

    // Parse preset value (default to 10)
    let presetValue = 10;
    if (pvArg && pvArg.expression.type === 'Literal') {
      const pvExpr = pvArg.expression as STLiteral;
      presetValue = typeof pvExpr.value === 'number' ? pvExpr.value : parseInt(String(pvExpr.value), 10) || 10;
    }

    // Build input network from CU or CD argument based on counter type
    let counterInput: ContactNetwork = inputNetwork;
    if (fbInfo.type === 'CTU' && cuArg) {
      counterInput = expressionToContactNetwork(cuArg.expression);
    } else if (fbInfo.type === 'CTD' && cdArg) {
      counterInput = expressionToContactNetwork(cdArg.expression);
    } else if (fbInfo.type === 'CTUD') {
      // For CTUD, prefer CU if available, otherwise use the existing input
      if (cuArg) {
        counterInput = expressionToContactNetwork(cuArg.expression);
      }
    }

    return createRung(
      `rung_${index}`,
      index,
      stmt,
      counterInput,
      createCounterOutput(stmt.instanceName, fbInfo.type, presetValue, counterInput)
    );
  }

  // Fallback for unknown function block types
  return createRung(
    `rung_${index}`,
    index,
    stmt,
    inputNetwork,
    createCoil(`${stmt.instanceName}.Q`, 'standard')
  );
}

function ifStatementToRungs(
  stmt: STIfStatement,
  baseIndex: number,
  variables: Map<string, VariableInfo>,
  functionBlocks: Map<string, FunctionBlockInfo>
): LadderRungIR[] {
  const rungs: LadderRungIR[] = [];

  // Convert the condition to a contact network
  const conditionNetwork = expressionToContactNetwork(stmt.condition);

  // Process all statements in the THEN branch recursively
  for (const thenStmt of stmt.thenBranch) {
    const stmtRungs = statementToRungs(thenStmt, baseIndex + rungs.length, variables, functionBlocks);

    // Prepend the IF condition to each rung's input network
    for (const rung of stmtRungs) {
      if (rung.inputNetwork.type === 'true') {
        rung.inputNetwork = conditionNetwork;
      } else {
        // Combine IF condition with statement's own condition (series)
        rung.inputNetwork = flattenSeries([conditionNetwork, rung.inputNetwork]);
      }
      rungs.push(rung);
    }
  }

  // Process ELSIF clauses
  for (const elsif of stmt.elsifClauses) {
    const elsifCondition = expressionToContactNetwork(elsif.condition);
    // ELSIF means NOT(previous conditions) AND this condition
    // For simplicity, we just use the ELSIF condition directly

    for (const elsifStmt of elsif.statements) {
      const stmtRungs = statementToRungs(elsifStmt, baseIndex + rungs.length, variables, functionBlocks);

      // Prepend the ELSIF condition to each rung
      for (const rung of stmtRungs) {
        if (rung.inputNetwork.type === 'true') {
          rung.inputNetwork = elsifCondition;
        } else {
          rung.inputNetwork = flattenSeries([elsifCondition, rung.inputNetwork]);
        }
        rungs.push(rung);
      }
    }
  }

  // Process ELSE clause
  if (stmt.elseBranch) {
    // ELSE means NOT(IF condition AND all ELSIF conditions)
    const negatedCondition = negateNetwork(conditionNetwork);

    for (const elseStmt of stmt.elseBranch) {
      const stmtRungs = statementToRungs(elseStmt, baseIndex + rungs.length, variables, functionBlocks);

      // Prepend the negated condition to each rung
      for (const rung of stmtRungs) {
        if (rung.inputNetwork.type === 'true') {
          rung.inputNetwork = negatedCondition;
        } else {
          rung.inputNetwork = flattenSeries([negatedCondition, rung.inputNetwork]);
        }
        rungs.push(rung);
      }
    }
  }

  return rungs;
}

function caseStatementToRungs(
  stmt: STCaseStatement,
  baseIndex: number,
  variables: Map<string, VariableInfo>,
  functionBlocks: Map<string, FunctionBlockInfo>
): LadderRungIR[] {
  const rungs: LadderRungIR[] = [];

  // For each CASE clause, create rungs with the case expression as condition
  // CASE X OF
  //   0: stmt1;   -> IF X = 0 THEN stmt1
  //   1: stmt2;   -> IF X = 1 THEN stmt2
  // END_CASE

  for (const caseClause of stmt.cases) {
    // Build the condition for this case clause
    // Multiple labels (0, 1, 2: stmt) become OR conditions
    const labelConditions: ContactNetwork[] = [];

    for (const label of caseClause.labels) {
      if (label.type === 'single' && label.value !== undefined) {
        // Single value: expression = value
        labelConditions.push(
          createComparator(
            'EQ',
            expressionToString(stmt.expression),
            String(label.value)
          )
        );
      } else if (label.type === 'range' && label.start !== undefined && label.end !== undefined) {
        // Range: expression >= start AND expression <= end
        const rangeCondition = createSeries([
          createComparator('GE', expressionToString(stmt.expression), String(label.start)),
          createComparator('LE', expressionToString(stmt.expression), String(label.end)),
        ]);
        labelConditions.push(rangeCondition);
      }
    }

    // Combine labels with OR (parallel)
    const caseCondition: ContactNetwork = labelConditions.length === 1
      ? labelConditions[0]
      : labelConditions.length > 1
        ? createParallel(labelConditions)
        : { type: 'true' };

    // Process statements in this case clause
    for (const caseStmt of caseClause.statements) {
      const stmtRungs = statementToRungs(caseStmt, baseIndex + rungs.length, variables, functionBlocks);

      // Prepend the case condition to each rung's input network
      for (const rung of stmtRungs) {
        if (rung.inputNetwork.type === 'true') {
          rung.inputNetwork = caseCondition;
        } else {
          // Combine case condition with statement's own condition (series)
          rung.inputNetwork = flattenSeries([caseCondition, rung.inputNetwork]);
        }
        rungs.push(rung);
      }
    }
  }

  // Process ELSE clause
  if (stmt.elseBranch) {
    // ELSE means none of the case values matched
    // For simplicity, we don't negate all conditions - just process statements
    // A more complete implementation would build NOT(case0 OR case1 OR ...)
    for (const elseStmt of stmt.elseBranch) {
      const stmtRungs = statementToRungs(elseStmt, baseIndex + rungs.length, variables, functionBlocks);
      rungs.push(...stmtRungs);
    }
  }

  return rungs;
}

// ============================================================================
// Expression to Contact Network Conversion
// ============================================================================

/**
 * Convert a boolean ST expression to a contact network.
 * This is the core of the ST -> Ladder transformation.
 */
export function expressionToContactNetwork(expr: STExpression): ContactNetwork {
  switch (expr.type) {
    case 'BinaryExpr':
      return binaryExprToNetwork(expr);
    case 'UnaryExpr':
      return unaryExprToNetwork(expr);
    case 'Variable':
      return variableToContact(expr);
    case 'Literal':
      return literalToNetwork(expr);
    case 'ParenExpr':
      return expressionToContactNetwork(expr.expression);
    case 'FunctionCall':
      // Function calls in expressions (like Timer.Q) become contacts
      return functionCallToContact(expr);
    default:
      return { type: 'true' };
  }
}

function binaryExprToNetwork(expr: STBinaryExpr): ContactNetwork {
  const left = expressionToContactNetwork(expr.left);
  const right = expressionToContactNetwork(expr.right);

  switch (expr.operator) {
    case 'AND':
      // A AND B = series connection
      return flattenSeries([left, right]);

    case 'OR':
      // A OR B = parallel branches
      return flattenParallel([left, right]);

    case 'XOR':
      // XOR = (A AND NOT B) OR (NOT A AND B)
      return createParallel([
        flattenSeries([left, negateNetwork(right)]),
        flattenSeries([negateNetwork(left), right]),
      ]);

    // Comparison operators become comparator blocks
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return createComparator(
        binaryOpToComparatorOp(expr.operator),
        expressionToString(expr.left),
        expressionToString(expr.right),
        expr
      );

    // Arithmetic operators in boolean context - should be in comparators
    default:
      // For arithmetic expressions used in boolean context,
      // treat non-zero as true - create a comparator != 0
      return createComparator(
        'NE',
        expressionToString(expr),
        '0',
        expr
      );
  }
}

function unaryExprToNetwork(expr: STUnaryExpr): ContactNetwork {
  if (expr.operator === 'NOT') {
    return negateNetwork(expressionToContactNetwork(expr.operand));
  }
  // Unary minus in boolean context - shouldn't happen in well-formed code
  return expressionToContactNetwork(expr.operand);
}

function variableToContact(expr: STVariable): ContactElement {
  const name = expr.accessPath.join('.');
  return createContact(name, 'NO', expr);
}

function literalToNetwork(expr: STLiteral): ContactNetwork {
  if (expr.literalType === 'BOOL') {
    if (expr.value === true) {
      return { type: 'true' };
    } else {
      // FALSE - create an NC contact on a dummy variable that's always FALSE
      // Or use a true contact and negate it
      return createContact('FALSE', 'NC', expr);
    }
  }
  // Non-boolean literals in boolean context - compare to zero
  return createComparator('NE', expr.rawValue, '0', expr);
}

function functionCallToContact(expr: STFunctionCall): ContactElement {
  // Function calls like Timer.Q become contacts
  return createContact(expr.name, 'NO', expr);
}

// ============================================================================
// Network Manipulation Functions
// ============================================================================

/**
 * Negate a contact network using De Morgan's laws:
 * - NOT(single contact) = flip NO/NC
 * - NOT(A AND B) = (NOT A) OR (NOT B)
 * - NOT(A OR B) = (NOT A) AND (NOT B)
 */
export function negateNetwork(network: ContactNetwork): ContactNetwork {
  switch (network.type) {
    case 'contact':
      // Flip NO <-> NC
      return {
        ...network,
        contactType: network.contactType === 'NO' ? 'NC' : 'NO',
      };

    case 'series':
      // NOT(A AND B) = (NOT A) OR (NOT B)
      return createParallel(network.elements.map(negateNetwork));

    case 'parallel':
      // NOT(A OR B) = (NOT A) AND (NOT B)
      return createSeries(network.branches.map(negateNetwork));

    case 'true':
      // NOT TRUE = always-false contact
      return createContact('TRUE', 'NC');

    case 'comparator':
      // Negate the comparison operator
      return {
        ...network,
        operator: negateComparatorOp(network.operator),
      };
  }
}

function negateComparatorOp(op: ComparatorOp): ComparatorOp {
  switch (op) {
    case 'EQ': return 'NE';
    case 'NE': return 'EQ';
    case 'GT': return 'LE';
    case 'GE': return 'LT';
    case 'LT': return 'GE';
    case 'LE': return 'GT';
  }
}

/**
 * Flatten nested series networks for cleaner representation.
 * [A, series([B, C])] -> series([A, B, C])
 */
export function flattenSeries(elements: ContactNetwork[]): ContactNetwork {
  const flattened: ContactNetwork[] = [];

  for (const el of elements) {
    if (el.type === 'series') {
      flattened.push(...el.elements);
    } else if (el.type === 'true') {
      // Skip true elements in series (they don't affect the result)
      continue;
    } else {
      flattened.push(el);
    }
  }

  if (flattened.length === 0) {
    return { type: 'true' };
  }
  if (flattened.length === 1) {
    return flattened[0];
  }
  return createSeries(flattened);
}

/**
 * Flatten nested parallel networks for cleaner representation.
 * [A, parallel([B, C])] -> parallel([A, B, C])
 */
export function flattenParallel(branches: ContactNetwork[]): ContactNetwork {
  const flattened: ContactNetwork[] = [];

  for (const branch of branches) {
    if (branch.type === 'parallel') {
      flattened.push(...branch.branches);
    } else if (branch.type === 'true') {
      // A true element in parallel means the whole thing is true
      return { type: 'true' };
    } else {
      flattened.push(branch);
    }
  }

  if (flattened.length === 0) {
    return { type: 'true' };
  }
  if (flattened.length === 1) {
    return flattened[0];
  }
  return createParallel(flattened);
}

// ============================================================================
// Helper Functions
// ============================================================================

function binaryOpToComparatorOp(op: BinaryOperator): ComparatorOp {
  switch (op) {
    case '=': return 'EQ';
    case '<>': return 'NE';
    case '<': return 'LT';
    case '>': return 'GT';
    case '<=': return 'LE';
    case '>=': return 'GE';
    default: return 'EQ';
  }
}

/**
 * Convert an expression to its string representation.
 * Used for comparator operands and timer presets.
 */
export function expressionToString(expr: STExpression): string {
  switch (expr.type) {
    case 'Variable':
      return expr.accessPath.join('.');
    case 'Literal':
      return expr.rawValue;
    case 'BinaryExpr':
      return `${expressionToString(expr.left)} ${expr.operator} ${expressionToString(expr.right)}`;
    case 'UnaryExpr':
      return `${expr.operator} ${expressionToString(expr.operand)}`;
    case 'ParenExpr':
      return `(${expressionToString(expr.expression)})`;
    case 'FunctionCall':
      return expr.name;
    default:
      return '';
  }
}

