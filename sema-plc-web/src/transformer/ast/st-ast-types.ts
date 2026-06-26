/**
 * Structured Text AST Type Definitions
 *
 * These types represent the Abstract Syntax Tree for IEC 61131-3 Structured Text.
 * The AST is built from the Lezer CST (Concrete Syntax Tree) and provides a typed,
 * easier-to-work-with representation for transformation to ladder diagrams.
 */

// ============================================================================
// Source Location (for error reporting and roundtrip fidelity)
// ============================================================================

export interface SourceLocation {
  start: number;
  end: number;
}

// ============================================================================
// Base AST Node
// ============================================================================

export interface ASTNode {
  type: string;
  loc: SourceLocation;
}

// ============================================================================
// Variable Declarations
// ============================================================================

export type VariableScopeKind =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_TEMP'
  | 'VAR_GLOBAL'
  | 'VAR_EXTERNAL';

export type VariableQualifier = 'CONSTANT' | 'RETAIN';

export interface STTypeSpec extends ASTNode {
  type: 'TypeSpec';
  typeName: string;
  isArray: boolean;
  /** Single range for single-dimensional arrays (legacy) */
  arrayRange?: { start: number; end: number };
  /** Multiple ranges for multi-dimensional arrays: ARRAY[1..3, 1..4] OF INT */
  arrayRanges?: { start: number; end: number }[];
}

export interface STVariableDecl extends ASTNode {
  type: 'VariableDecl';
  names: string[];
  dataType: STTypeSpec;
  initialValue?: STExpression;
  /** AT address for direct hardware addressing (e.g., %IX0.0, %MW0, %QX1.2) */
  atAddress?: string;
}

export interface STVarBlock extends ASTNode {
  type: 'VarBlock';
  scope: VariableScopeKind;
  qualifier?: VariableQualifier;
  declarations: STVariableDecl[];
}

// ============================================================================
// Expressions
// ============================================================================

export type STExpression =
  | STBinaryExpr
  | STUnaryExpr
  | STVariable
  | STLiteral
  | STFunctionCall
  | STParenExpr;

export type BinaryOperator =
  | 'AND'
  | 'OR'
  | 'XOR'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | 'MOD'
  | '**';

export interface STBinaryExpr extends ASTNode {
  type: 'BinaryExpr';
  operator: BinaryOperator;
  left: STExpression;
  right: STExpression;
}

export type UnaryOperator = 'NOT' | '-';

export interface STUnaryExpr extends ASTNode {
  type: 'UnaryExpr';
  operator: UnaryOperator;
  operand: STExpression;
}

/**
 * Access path element - can be a field name or an array index
 */
export type AccessPathElement =
  | { kind: 'field'; name: string }
  | { kind: 'index'; expression: STExpression };

export interface STVariable extends ASTNode {
  type: 'Variable';
  name: string;
  accessPath: string[]; // Legacy: For nested access like Timer1.Q -> ['Timer1', 'Q']
  arrayIndices?: STExpression[]; // Array index expressions (e.g., arr[5] -> [5], arr[i][j] -> [i, j])
}

export type LiteralType = 'BOOL' | 'INT' | 'REAL' | 'TIME' | 'DATE' | 'TIME_OF_DAY' | 'DATE_AND_TIME' | 'STRING' | 'ENUM';

export interface STLiteral extends ASTNode {
  type: 'Literal';
  value: boolean | number | string;
  literalType: LiteralType;
  rawValue: string; // Original text (e.g., "T#5s", "TRUE")
}

export interface STFunctionCall extends ASTNode {
  type: 'FunctionCall';
  name: string;
  arguments: STExpression[];
}

export interface STParenExpr extends ASTNode {
  type: 'ParenExpr';
  expression: STExpression;
}

// ============================================================================
// Statements
// ============================================================================

export type STStatement =
  | STAssignment
  | STFunctionBlockCall
  | STIfStatement
  | STCaseStatement
  | STForStatement
  | STWhileStatement
  | STRepeatStatement
  | STReturnStatement
  | STExitStatement
  | STContinueStatement;

export interface STAssignment extends ASTNode {
  type: 'Assignment';
  target: STVariable;
  expression: STExpression;
}

export interface STNamedArgument {
  name: string;
  expression: STExpression;
}

export interface STFunctionBlockCall extends ASTNode {
  type: 'FunctionBlockCall';
  instanceName: string;
  arguments: STNamedArgument[];
}

export interface STElsifClause {
  condition: STExpression;
  statements: STStatement[];
}

export interface STIfStatement extends ASTNode {
  type: 'IfStatement';
  condition: STExpression;
  thenBranch: STStatement[];
  elsifClauses: STElsifClause[];
  elseBranch?: STStatement[];
}

export interface STCaseLabel {
  type: 'single' | 'range';
  value?: number;
  start?: number;
  end?: number;
}

export interface STCaseClause {
  labels: STCaseLabel[];
  statements: STStatement[];
}

export interface STCaseStatement extends ASTNode {
  type: 'CaseStatement';
  expression: STExpression;
  cases: STCaseClause[];
  elseBranch?: STStatement[];
}

export interface STForStatement extends ASTNode {
  type: 'ForStatement';
  variable: string;
  startValue: STExpression;
  endValue: STExpression;
  step?: STExpression;
  body: STStatement[];
}

export interface STWhileStatement extends ASTNode {
  type: 'WhileStatement';
  condition: STExpression;
  body: STStatement[];
}

export interface STRepeatStatement extends ASTNode {
  type: 'RepeatStatement';
  body: STStatement[];
  condition: STExpression;
}

export interface STReturnStatement extends ASTNode {
  type: 'ReturnStatement';
}

export interface STExitStatement extends ASTNode {
  type: 'ExitStatement';
}

export interface STContinueStatement extends ASTNode {
  type: 'ContinueStatement';
}

// ============================================================================
// Program Structure
// ============================================================================

export type ProgramType = 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK';

export interface STProgram extends ASTNode {
  type: 'Program';
  name: string;
  programType: ProgramType;
  returnType?: string; // Only for FUNCTION - the return type (INT, BOOL, REAL, etc.)
  varBlocks: STVarBlock[];
  statements: STStatement[];
}

// ============================================================================
// Type Definitions (STRUCT, etc.)
// ============================================================================

/**
 * A field within a STRUCT definition.
 */
export interface STStructField extends ASTNode {
  type: 'StructField';
  name: string;
  dataType: STTypeSpec;
  initialValue?: STExpression;
}

/**
 * An enumeration value with name and optional explicit integer value.
 * If value is not specified, it auto-increments from the previous value.
 */
export interface STEnumValue {
  name: string;
  value: number;
}

/**
 * A user-defined type definition (STRUCT, ENUM, etc.).
 */
export interface STTypeDef extends ASTNode {
  type: 'TypeDef';
  name: string;
  defType: 'STRUCT' | 'ENUM';
  /** Fields of a STRUCT type */
  structFields?: STStructField[];
  /** Values of an ENUM type */
  enumValues?: STEnumValue[];
}

// ============================================================================
// Root AST
// ============================================================================

export interface ParseError {
  message: string;
  loc: SourceLocation;
  severity: 'error' | 'warning';
}

export interface STAST {
  programs: STProgram[];
  /** Top-level statements outside any program block */
  topLevelStatements: STStatement[];
  /** Top-level variable blocks outside any program block */
  topLevelVarBlocks: STVarBlock[];
  /** User-defined type definitions (STRUCT, ENUM, etc.) */
  typeDefinitions: STTypeDef[];
  errors: ParseError[];
}

// ============================================================================
// Type Guards
// ============================================================================

export function isSTBinaryExpr(node: STExpression): node is STBinaryExpr {
  return node.type === 'BinaryExpr';
}

export function isSTUnaryExpr(node: STExpression): node is STUnaryExpr {
  return node.type === 'UnaryExpr';
}

export function isSTVariable(node: STExpression): node is STVariable {
  return node.type === 'Variable';
}

export function isSTLiteral(node: STExpression): node is STLiteral {
  return node.type === 'Literal';
}

export function isSTFunctionCall(node: STExpression): node is STFunctionCall {
  return node.type === 'FunctionCall';
}

export function isSTParenExpr(node: STExpression): node is STParenExpr {
  return node.type === 'ParenExpr';
}

export function isBooleanOperator(op: BinaryOperator): boolean {
  return op === 'AND' || op === 'OR' || op === 'XOR';
}

export function isComparisonOperator(op: BinaryOperator): boolean {
  return op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=';
}

export function isArithmeticOperator(op: BinaryOperator): boolean {
  return op === '+' || op === '-' || op === '*' || op === '/' || op === 'MOD' || op === '**';
}
