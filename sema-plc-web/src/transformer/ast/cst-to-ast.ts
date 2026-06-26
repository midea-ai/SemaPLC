/**
 * CST to AST Converter
 *
 * Walks the Lezer parse tree (CST) and builds a typed AST.
 * The CST is produced by the Lezer parser from st.grammar.
 */

import { Tree } from '@lezer/common';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '../../lang/st-parser';
import type {
  STAST,
  STProgram,
  STVarBlock,
  STVariableDecl,
  STTypeSpec,
  STStatement,
  STExpression,
  STAssignment,
  STFunctionBlockCall,
  STNamedArgument,
  STIfStatement,
  STElsifClause,
  STCaseStatement,
  STCaseClause,
  STCaseLabel,
  STForStatement,
  STWhileStatement,
  STRepeatStatement,
  STVariable,
  STLiteral,
  STFunctionCall,
  STTypeDef,
  STStructField,
  STEnumValue,
  VariableScopeKind,
  VariableQualifier,
  BinaryOperator,
  ProgramType,
  ParseError,
  SourceLocation,
} from './st-ast-types';

// ============================================================================
// Main Entry Point
// ============================================================================

export function parseSTToAST(source: string): STAST {
  const tree = parser.parse(source);
  const programs: STProgram[] = [];
  const topLevelStatements: STStatement[] = [];
  const topLevelVarBlocks: STVarBlock[] = [];
  const typeDefinitions: STTypeDef[] = [];
  const errors: ParseError[] = [];

  // Collect any syntax errors from the tree
  collectErrors(tree, source, errors);

  // Walk the top-level nodes
  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do {
      const nodeType = cursor.name;
      const loc = { start: cursor.from, end: cursor.to };

      switch (nodeType) {
        case 'ProgramDecl':
          programs.push(parseProgramDecl(cursor.node, source, 'PROGRAM'));
          break;
        case 'FunctionDecl':
          programs.push(parseFunctionDecl(cursor.node, source));
          break;
        case 'FunctionBlockDecl':
          programs.push(parseProgramDecl(cursor.node, source, 'FUNCTION_BLOCK'));
          break;
        case 'TypeDecl':
          typeDefinitions.push(...parseTypeDecl(cursor.node, source));
          break;
        case 'VarBlock':
          topLevelVarBlocks.push(parseVarBlock(cursor.node, source));
          break;
        case 'Assignment':
          topLevelStatements.push(parseAssignment(cursor.node, source));
          break;
        case 'FunctionBlockCall':
          topLevelStatements.push(parseFunctionBlockCall(cursor.node, source));
          break;
        case 'IfStatement':
          topLevelStatements.push(parseIfStatement(cursor.node, source));
          break;
        case 'CaseStatement':
          topLevelStatements.push(parseCaseStatement(cursor.node, source));
          break;
        case 'ForStatement':
          topLevelStatements.push(parseForStatement(cursor.node, source));
          break;
        case 'WhileStatement':
          topLevelStatements.push(parseWhileStatement(cursor.node, source));
          break;
        case 'RepeatStatement':
          topLevelStatements.push(parseRepeatStatement(cursor.node, source));
          break;
        case 'ReturnStatement':
          topLevelStatements.push({ type: 'ReturnStatement', loc });
          break;
        case 'ExitStatement':
          topLevelStatements.push({ type: 'ExitStatement', loc });
          break;
        case 'ContinueStatement':
          topLevelStatements.push({ type: 'ContinueStatement', loc });
          break;
        // Skip whitespace, comments, and error nodes handled elsewhere
        case '⚠':
        case 'LineComment':
        case 'BlockComment':
          break;
      }
    } while (cursor.nextSibling());
  }

  return { programs, topLevelStatements, topLevelVarBlocks, typeDefinitions, errors };
}

// ============================================================================
// Error Collection
// ============================================================================

function collectErrors(tree: Tree, _source: string, errors: ParseError[]): void {
  const cursor = tree.cursor();
  do {
    if (cursor.name === '⚠') {
      errors.push({
        message: `Syntax error at position ${cursor.from}`,
        loc: { start: cursor.from, end: cursor.to },
        severity: 'error',
      });
    }
  } while (cursor.next());
}

// ============================================================================
// Program/Function Block Parsing
// ============================================================================

function parseProgramDecl(
  node: SyntaxNode,
  source: string,
  programType: ProgramType
): STProgram {
  const loc = { start: node.from, end: node.to };
  let name = 'Untitled';
  const varBlocks: STVarBlock[] = [];
  const statements: STStatement[] = [];

  // Walk children
  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'VarBlock':
        varBlocks.push(parseVarBlock(child, source));
        break;
      case 'Assignment':
        statements.push(parseAssignment(child, source));
        break;
      case 'FunctionBlockCall':
        statements.push(parseFunctionBlockCall(child, source));
        break;
      case 'IfStatement':
        statements.push(parseIfStatement(child, source));
        break;
      case 'CaseStatement':
        statements.push(parseCaseStatement(child, source));
        break;
      case 'ForStatement':
        statements.push(parseForStatement(child, source));
        break;
      case 'WhileStatement':
        statements.push(parseWhileStatement(child, source));
        break;
      case 'RepeatStatement':
        statements.push(parseRepeatStatement(child, source));
        break;
      case 'ReturnStatement':
        statements.push({ type: 'ReturnStatement', loc: { start: child.from, end: child.to } });
        break;
      case 'ExitStatement':
        statements.push({ type: 'ExitStatement', loc: { start: child.from, end: child.to } });
        break;
      case 'ContinueStatement':
        statements.push({ type: 'ContinueStatement', loc: { start: child.from, end: child.to } });
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'Program', name, programType, varBlocks, statements, loc };
}

function parseFunctionDecl(node: SyntaxNode, source: string): STProgram {
  const loc = { start: node.from, end: node.to };
  let name = 'Untitled';
  let returnType = 'INT';
  const varBlocks: STVarBlock[] = [];
  const statements: STStatement[] = [];
  let foundName = false;

  // Walk children: FUNCTION Identifier ":" TypeName statement* END_FUNCTION
  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        if (!foundName) {
          name = source.slice(child.from, child.to);
          foundName = true;
        }
        break;
      case 'TypeName':
        returnType = parseTypeName(child, source);
        break;
      case 'VarBlock':
        varBlocks.push(parseVarBlock(child, source));
        break;
      case 'Assignment':
        statements.push(parseAssignment(child, source));
        break;
      case 'FunctionBlockCall':
        statements.push(parseFunctionBlockCall(child, source));
        break;
      case 'IfStatement':
        statements.push(parseIfStatement(child, source));
        break;
      case 'CaseStatement':
        statements.push(parseCaseStatement(child, source));
        break;
      case 'ForStatement':
        statements.push(parseForStatement(child, source));
        break;
      case 'WhileStatement':
        statements.push(parseWhileStatement(child, source));
        break;
      case 'RepeatStatement':
        statements.push(parseRepeatStatement(child, source));
        break;
      case 'ReturnStatement':
        statements.push({ type: 'ReturnStatement', loc: { start: child.from, end: child.to } });
        break;
      case 'ExitStatement':
        statements.push({ type: 'ExitStatement', loc: { start: child.from, end: child.to } });
        break;
      case 'ContinueStatement':
        statements.push({ type: 'ContinueStatement', loc: { start: child.from, end: child.to } });
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'Program', name, programType: 'FUNCTION', returnType, varBlocks, statements, loc };
}

// ============================================================================
// Type Declaration Parsing (STRUCT, etc.)
// ============================================================================

/**
 * Parse a TYPE...END_TYPE block.
 * Returns an array of type definitions (one TYPE block can contain multiple STRUCTs or ENUMs).
 */
function parseTypeDecl(node: SyntaxNode, source: string): STTypeDef[] {
  const typeDefs: STTypeDef[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === 'StructDef') {
      typeDefs.push(parseStructDef(child, source));
    } else if (child.name === 'EnumDef') {
      typeDefs.push(parseEnumDef(child, source));
    }
    child = child.nextSibling;
  }

  return typeDefs;
}

/**
 * Parse a STRUCT definition.
 */
function parseStructDef(node: SyntaxNode, source: string): STTypeDef {
  const loc = { start: node.from, end: node.to };
  let name = 'UnnamedStruct';
  const structFields: STStructField[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'StructField':
        structFields.push(parseStructField(child, source));
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'TypeDef', name, defType: 'STRUCT', structFields, loc };
}

/**
 * Parse a field within a STRUCT definition.
 */
function parseStructField(node: SyntaxNode, source: string): STStructField {
  const loc = { start: node.from, end: node.to };
  let name = 'unnamed';
  let dataType: STTypeSpec = { type: 'TypeSpec', typeName: 'INT', isArray: false, loc };
  let initialValue: STExpression | undefined;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'TypeSpec':
        dataType = parseTypeSpec(child, source);
        break;
      case 'Expression':
        initialValue = parseExpression(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'StructField', name, dataType, initialValue, loc };
}

/**
 * Parse an ENUM definition.
 * Format: TypeName : (Value1, Value2 := 5, Value3);
 */
function parseEnumDef(node: SyntaxNode, source: string): STTypeDef {
  const loc = { start: node.from, end: node.to };
  let name = 'UnnamedEnum';
  const enumValues: STEnumValue[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'EnumValueList':
        parseEnumValueList(child, source, enumValues);
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'TypeDef', name, defType: 'ENUM', enumValues, loc };
}

/**
 * Parse the list of enum values, handling auto-incrementing values.
 */
function parseEnumValueList(node: SyntaxNode, source: string, enumValues: STEnumValue[]): void {
  let nextValue = 0;

  let child = node.firstChild;
  while (child) {
    if (child.name === 'EnumValue') {
      const enumValue = parseEnumValue(child, source, nextValue);
      enumValues.push(enumValue);
      // Next auto-increment value is one more than this value
      nextValue = enumValue.value + 1;
    }
    child = child.nextSibling;
  }
}

/**
 * Parse a single enum value with optional explicit integer value.
 */
function parseEnumValue(node: SyntaxNode, source: string, defaultValue: number): STEnumValue {
  let name = 'UnnamedValue';
  let value = defaultValue;
  let hasExplicitValue = false;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'Number':
        value = parseInt(source.slice(child.from, child.to), 10);
        hasExplicitValue = true;
        break;
    }
    child = child.nextSibling;
  }

  // If no explicit value, use the default (auto-incremented)
  if (!hasExplicitValue) {
    value = defaultValue;
  }

  return { name, value };
}

// ============================================================================
// Variable Block Parsing
// ============================================================================

function parseVarBlock(node: SyntaxNode, source: string): STVarBlock {
  const loc = { start: node.from, end: node.to };
  let scope: VariableScopeKind = 'VAR';
  let qualifier: VariableQualifier | undefined;
  const declarations: STVariableDecl[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'VarKeyword':
        scope = parseVarKeyword(child, source);
        break;
      case 'VarQualifier':
        qualifier = parseVarQualifier(child, source);
        break;
      case 'VariableDecl':
        declarations.push(parseVariableDecl(child, source));
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'VarBlock', scope, qualifier, declarations, loc };
}

function parseVarQualifier(node: SyntaxNode, source: string): VariableQualifier | undefined {
  const text = source.slice(node.from, node.to).toUpperCase().trim();
  if (text === 'CONSTANT') return 'CONSTANT';
  if (text === 'RETAIN') return 'RETAIN';
  return undefined;
}

function parseVarKeyword(node: SyntaxNode, source: string): VariableScopeKind {
  const text = source.slice(node.from, node.to).toUpperCase().trim();
  if (text.includes('VAR_INPUT')) return 'VAR_INPUT';
  if (text.includes('VAR_OUTPUT')) return 'VAR_OUTPUT';
  if (text.includes('VAR_IN_OUT')) return 'VAR_IN_OUT';
  if (text.includes('VAR_TEMP')) return 'VAR_TEMP';
  if (text.includes('VAR_EXTERNAL')) return 'VAR_EXTERNAL';
  if (text.includes('VAR_GLOBAL')) return 'VAR_GLOBAL';
  return 'VAR';
}

function parseVariableDecl(node: SyntaxNode, source: string): STVariableDecl {
  const loc = { start: node.from, end: node.to };
  const names: string[] = [];
  let dataType: STTypeSpec = { type: 'TypeSpec', typeName: 'BOOL', isArray: false, loc };
  let initialValue: STExpression | undefined;
  let atAddress: string | undefined;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'VariableList':
        names.push(...parseVariableList(child, source));
        break;
      case 'AtAddress':
        atAddress = parseAtAddress(child, source);
        break;
      case 'TypeSpec':
        dataType = parseTypeSpec(child, source);
        break;
      case 'Expression':
        initialValue = parseExpression(child, source);
        break;
    }
    child = child.nextSibling;
  }

  const result: STVariableDecl = { type: 'VariableDecl', names, dataType, initialValue, loc };
  if (atAddress) {
    result.atAddress = atAddress;
  }
  return result;
}

/**
 * Parse an AT address from the AtAddress node.
 * Returns the direct address string (e.g., "%IX0.0", "%MW10", "%QX1.2.3")
 */
function parseAtAddress(node: SyntaxNode, source: string): string | undefined {
  let child = node.firstChild;
  while (child) {
    if (child.name === 'DirectAddress') {
      return source.slice(child.from, child.to);
    }
    child = child.nextSibling;
  }
  return undefined;
}

function parseVariableList(node: SyntaxNode, source: string): string[] {
  const names: string[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Identifier') {
      names.push(source.slice(child.from, child.to));
    }
    child = child.nextSibling;
  }
  return names;
}

function parseTypeSpec(node: SyntaxNode, source: string): STTypeSpec {
  const loc = { start: node.from, end: node.to };
  let typeName = 'BOOL';
  let isArray = false;
  let arrayRange: { start: number; end: number } | undefined;
  let arrayRanges: { start: number; end: number }[] | undefined;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'TypeName':
        typeName = parseTypeName(child, source);
        break;
      case 'ArrayType':
        isArray = true;
        const result = parseArrayType(child, source);
        typeName = result.typeName;
        // Support both single and multi-dimensional arrays
        if (result.ranges && result.ranges.length > 0) {
          arrayRanges = result.ranges;
          // For backwards compatibility, also set arrayRange for single-dimensional
          if (result.ranges.length === 1) {
            arrayRange = result.ranges[0];
          }
        }
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'TypeSpec', typeName, isArray, arrayRange, arrayRanges, loc };
}

function parseTypeName(node: SyntaxNode, source: string): string {
  // TypeName contains the actual type keyword or identifier
  let child = node.firstChild;
  while (child) {
    const text = source.slice(child.from, child.to);
    if (text) return text;
    child = child.nextSibling;
  }
  return source.slice(node.from, node.to);
}

function parseArrayType(
  node: SyntaxNode,
  source: string
): { typeName: string; ranges: { start: number; end: number }[] } {
  let typeName = 'BOOL';
  const ranges: { start: number; end: number }[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'RangeList':
        // Parse all ranges from the RangeList
        let rangeChild = child.firstChild;
        while (rangeChild) {
          if (rangeChild.name === 'Range') {
            ranges.push(parseRange(rangeChild, source));
          }
          rangeChild = rangeChild.nextSibling;
        }
        break;
      case 'Range':
        // Fallback for grammar without RangeList
        ranges.push(parseRange(child, source));
        break;
      case 'TypeName':
        typeName = parseTypeName(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { typeName, ranges };
}

function parseRange(node: SyntaxNode, source: string): { start: number; end: number } {
  const numbers: number[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Number') {
      numbers.push(parseInt(source.slice(child.from, child.to), 10));
    }
    child = child.nextSibling;
  }
  return { start: numbers[0] ?? 0, end: numbers[1] ?? 0 };
}

// ============================================================================
// Statement Parsing
// ============================================================================

function parseAssignment(node: SyntaxNode, source: string): STAssignment {
  const loc = { start: node.from, end: node.to };
  let target: STVariable = { type: 'Variable', name: '', accessPath: [], loc };
  let expression: STExpression = { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Variable':
        target = parseVariable(child, source);
        break;
      case 'Expression':
        expression = parseExpression(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'Assignment', target, expression, loc };
}

function parseFunctionBlockCall(node: SyntaxNode, source: string): STFunctionBlockCall {
  const loc = { start: node.from, end: node.to };
  let instanceName = '';
  const args: STNamedArgument[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        instanceName = source.slice(child.from, child.to);
        break;
      case 'NamedArgumentList':
        args.push(...parseNamedArgumentList(child, source));
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'FunctionBlockCall', instanceName, arguments: args, loc };
}

function parseNamedArgumentList(node: SyntaxNode, source: string): STNamedArgument[] {
  const args: STNamedArgument[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'NamedArgument') {
      args.push(parseNamedArgument(child, source));
    }
    child = child.nextSibling;
  }
  return args;
}

function parseNamedArgument(node: SyntaxNode, source: string): STNamedArgument {
  let name = '';
  let expression: STExpression = {
    type: 'Literal',
    value: false,
    literalType: 'BOOL',
    rawValue: 'FALSE',
    loc: { start: node.from, end: node.to },
  };

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'Expression':
        expression = parseExpression(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { name, expression };
}

function parseIfStatement(node: SyntaxNode, source: string): STIfStatement {
  const loc = { start: node.from, end: node.to };
  let condition: STExpression = { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
  const thenBranch: STStatement[] = [];
  const elsifClauses: STElsifClause[] = [];
  let elseBranch: STStatement[] | undefined;

  let inThen = false;
  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'IF':
        inThen = false;
        break;
      case 'Expression':
        if (!inThen) {
          condition = parseExpression(child, source);
        }
        break;
      case 'THEN':
        inThen = true;
        break;
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        if (inThen) {
          thenBranch.push(parseStatementNode(child, source));
        }
        break;
      case 'ElsifClause':
        elsifClauses.push(parseElsifClause(child, source));
        break;
      case 'ElseClause':
        elseBranch = parseElseClause(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'IfStatement', condition, thenBranch, elsifClauses, elseBranch, loc };
}

function parseElsifClause(node: SyntaxNode, source: string): STElsifClause {
  let condition: STExpression = {
    type: 'Literal',
    value: false,
    literalType: 'BOOL',
    rawValue: 'FALSE',
    loc: { start: node.from, end: node.to },
  };
  const statements: STStatement[] = [];
  let inThen = false;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Expression':
        if (!inThen) {
          condition = parseExpression(child, source);
        }
        break;
      case 'THEN':
        inThen = true;
        break;
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        if (inThen) {
          statements.push(parseStatementNode(child, source));
        }
        break;
    }
    child = child.nextSibling;
  }

  return { condition, statements };
}

function parseElseClause(node: SyntaxNode, source: string): STStatement[] {
  const statements: STStatement[] = [];
  let child = node.firstChild;
  while (child) {
    if (isStatementNode(child.name)) {
      statements.push(parseStatementNode(child, source));
    }
    child = child.nextSibling;
  }
  return statements;
}

function parseCaseStatement(node: SyntaxNode, source: string): STCaseStatement {
  const loc = { start: node.from, end: node.to };
  let expression: STExpression = { type: 'Literal', value: 0, literalType: 'INT', rawValue: '0', loc };
  const cases: STCaseClause[] = [];
  let elseBranch: STStatement[] | undefined;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Expression':
        expression = parseExpression(child, source);
        break;
      case 'CaseClause':
        cases.push(parseCaseClause(child, source));
        break;
      case 'ElseClause':
        elseBranch = parseElseClause(child, source);
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'CaseStatement', expression, cases, elseBranch, loc };
}

function parseCaseClause(node: SyntaxNode, source: string): STCaseClause {
  const labels: STCaseLabel[] = [];
  const statements: STStatement[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'CaseLabel':
        labels.push(parseCaseLabel(child, source));
        break;
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        statements.push(parseStatementNode(child, source));
        break;
    }
    child = child.nextSibling;
  }

  return { labels, statements };
}

function parseCaseLabel(node: SyntaxNode, source: string): STCaseLabel {
  const numbers: number[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Number') {
      numbers.push(parseInt(source.slice(child.from, child.to), 10));
    }
    child = child.nextSibling;
  }

  if (numbers.length >= 2) {
    return { type: 'range', start: numbers[0], end: numbers[1] };
  }
  return { type: 'single', value: numbers[0] ?? 0 };
}

function parseForStatement(node: SyntaxNode, source: string): STForStatement {
  const loc = { start: node.from, end: node.to };
  let variable = '';
  let startValue: STExpression = { type: 'Literal', value: 0, literalType: 'INT', rawValue: '0', loc };
  let endValue: STExpression = { type: 'Literal', value: 0, literalType: 'INT', rawValue: '0', loc };
  let step: STExpression | undefined;
  const body: STStatement[] = [];

  let exprIndex = 0;
  let inDo = false;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        if (!variable) {
          variable = source.slice(child.from, child.to);
        }
        break;
      case 'Expression':
        if (!inDo) {
          if (exprIndex === 0) {
            startValue = parseExpression(child, source);
          } else if (exprIndex === 1) {
            endValue = parseExpression(child, source);
          } else if (exprIndex === 2) {
            step = parseExpression(child, source);
          }
          exprIndex++;
        }
        break;
      case 'DO':
        inDo = true;
        break;
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        if (inDo) {
          body.push(parseStatementNode(child, source));
        }
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'ForStatement', variable, startValue, endValue, step, body, loc };
}

function parseWhileStatement(node: SyntaxNode, source: string): STWhileStatement {
  const loc = { start: node.from, end: node.to };
  let condition: STExpression = { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
  const body: STStatement[] = [];
  let inDo = false;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Expression':
        if (!inDo) {
          condition = parseExpression(child, source);
        }
        break;
      case 'DO':
        inDo = true;
        break;
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        if (inDo) {
          body.push(parseStatementNode(child, source));
        }
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'WhileStatement', condition, body, loc };
}

function parseRepeatStatement(node: SyntaxNode, source: string): STRepeatStatement {
  const loc = { start: node.from, end: node.to };
  const body: STStatement[] = [];
  let condition: STExpression = { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
  let inUntil = false;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Assignment':
      case 'FunctionBlockCall':
      case 'IfStatement':
      case 'CaseStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
        if (!inUntil) {
          body.push(parseStatementNode(child, source));
        }
        break;
      case 'UNTIL':
        inUntil = true;
        break;
      case 'Expression':
        if (inUntil) {
          condition = parseExpression(child, source);
        }
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'RepeatStatement', body, condition, loc };
}

function isStatementNode(name: string): boolean {
  return [
    'Assignment',
    'FunctionBlockCall',
    'IfStatement',
    'CaseStatement',
    'ForStatement',
    'WhileStatement',
    'RepeatStatement',
    'ReturnStatement',
    'ExitStatement',
    'ContinueStatement',
  ].includes(name);
}

function parseStatementNode(node: SyntaxNode, source: string): STStatement {
  const loc = { start: node.from, end: node.to };
  switch (node.name) {
    case 'Assignment':
      return parseAssignment(node, source);
    case 'FunctionBlockCall':
      return parseFunctionBlockCall(node, source);
    case 'IfStatement':
      return parseIfStatement(node, source);
    case 'CaseStatement':
      return parseCaseStatement(node, source);
    case 'ForStatement':
      return parseForStatement(node, source);
    case 'WhileStatement':
      return parseWhileStatement(node, source);
    case 'RepeatStatement':
      return parseRepeatStatement(node, source);
    case 'ReturnStatement':
      return { type: 'ReturnStatement', loc };
    case 'ExitStatement':
      return { type: 'ExitStatement', loc };
    case 'ContinueStatement':
      return { type: 'ContinueStatement', loc };
    default:
      // Return a dummy statement for unknown types
      return { type: 'ReturnStatement', loc };
  }
}

// ============================================================================
// Expression Parsing
// ============================================================================

function parseExpression(node: SyntaxNode, source: string): STExpression {
  // Expression wraps OrExpression in the grammar
  let child = node.firstChild;
  while (child) {
    if (child.name === 'OrExpression') {
      return parseOrExpression(child, source);
    }
    child = child.nextSibling;
  }
  // Fallback: try to parse the node directly
  return parseExpressionNode(node, source);
}

function parseOrExpression(node: SyntaxNode, source: string): STExpression {
  return parseBinaryChain(node, source, 'AndExpression', 'OR');
}

function parseAndExpression(node: SyntaxNode, source: string): STExpression {
  return parseBinaryChain(node, source, 'XorExpression', 'AND');
}

function parseXorExpression(node: SyntaxNode, source: string): STExpression {
  return parseBinaryChain(node, source, 'CompareExpression', 'XOR');
}

function parseCompareExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  const operands: STExpression[] = [];
  let operator: BinaryOperator | null = null;

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'AddExpression':
        operands.push(parseAddExpression(child, source));
        break;
      case 'CompareOp':
        operator = parseCompareOp(child, source);
        break;
    }
    child = child.nextSibling;
  }

  if (operands.length === 1) {
    return operands[0];
  }

  if (operands.length >= 2 && operator) {
    return {
      type: 'BinaryExpr',
      operator,
      left: operands[0],
      right: operands[1],
      loc,
    };
  }

  return operands[0] ?? { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
}

function parseCompareOp(node: SyntaxNode, source: string): BinaryOperator {
  const text = source.slice(node.from, node.to);
  switch (text) {
    case '=':
      return '=';
    case '<>':
      return '<>';
    case '<':
      return '<';
    case '>':
      return '>';
    case '<=':
      return '<=';
    case '>=':
      return '>=';
    default:
      return '=';
  }
}

function parseAddExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  const parts: { expr: STExpression; op?: BinaryOperator }[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === 'MulExpression') {
      parts.push({ expr: parseMulExpression(child, source) });
    } else if (child.name === '+' || source.slice(child.from, child.to) === '+') {
      if (parts.length > 0) {
        parts[parts.length - 1].op = '+';
      }
    } else if (child.name === '-' || source.slice(child.from, child.to) === '-') {
      if (parts.length > 0) {
        parts[parts.length - 1].op = '-';
      }
    }
    child = child.nextSibling;
  }

  return buildLeftAssociativeExpr(parts, loc);
}

function parseMulExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  const parts: { expr: STExpression; op?: BinaryOperator }[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === 'UnaryExpression') {
      parts.push({ expr: parseUnaryExpression(child, source) });
    } else {
      const text = source.slice(child.from, child.to);
      if (text === '*' || text === '/' || text.toUpperCase() === 'MOD') {
        if (parts.length > 0) {
          parts[parts.length - 1].op = text === '*' ? '*' : text === '/' ? '/' : 'MOD';
        }
      }
    }
    child = child.nextSibling;
  }

  return buildLeftAssociativeExpr(parts, loc);
}

function parseUnaryExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  const unaryOps: Array<'NOT' | '-'> = [];
  let powerExpr: STExpression | null = null;

  let child = node.firstChild;
  while (child) {
    const text = source.slice(child.from, child.to);
    if (child.name === 'NOT' || text.toUpperCase() === 'NOT') {
      unaryOps.push('NOT');
    } else if (text === '-') {
      unaryOps.push('-');
    } else if (child.name === 'PowerExpression') {
      powerExpr = parsePowerExpression(child, source);
    }
    child = child.nextSibling;
  }

  if (powerExpr) {
    // Apply unary operators in reverse order (innermost first)
    let result = powerExpr;
    for (let i = unaryOps.length - 1; i >= 0; i--) {
      result = {
        type: 'UnaryExpr',
        operator: unaryOps[i],
        operand: result,
        loc,
      };
    }
    return result;
  }

  return { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
}

function parsePowerExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  const parts: { expr: STExpression; op?: BinaryOperator }[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === 'PrimaryExpression') {
      parts.push({ expr: parsePrimaryExpression(child, source) });
    } else {
      const text = source.slice(child.from, child.to);
      if (text === '**') {
        if (parts.length > 0) {
          parts[parts.length - 1].op = '**';
        }
      }
    }
    child = child.nextSibling;
  }

  // IEC 61131-3 specifies left-to-right associativity for **
  return buildLeftAssociativeExpr(parts, loc);
}

function parsePrimaryExpression(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Variable':
        return parseVariable(child, source);
      case 'Literal':
        return parseLiteral(child, source);
      case 'FunctionCall':
        return parseFunctionCallExpr(child, source);
      case 'Expression':
        const inner = parseExpression(child, source);
        return { type: 'ParenExpr', expression: inner, loc };
    }
    child = child.nextSibling;
  }

  return { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
}

function parseVariable(node: SyntaxNode, source: string): STVariable {
  const loc = { start: node.from, end: node.to };
  const accessPath: string[] = [];
  const arrayIndices: STExpression[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === 'Identifier') {
      accessPath.push(source.slice(child.from, child.to));
    } else if (child.name === 'ArrayIndex') {
      // ArrayIndex contains IndexList which contains comma-separated Expressions
      // This supports both arr[i] and arr[i, j] syntax
      let indexChild = child.firstChild;
      while (indexChild) {
        if (indexChild.name === 'IndexList') {
          // Parse all expressions in the IndexList
          let listChild = indexChild.firstChild;
          while (listChild) {
            if (listChild.name === 'Expression') {
              arrayIndices.push(parseExpression(listChild, source));
            }
            listChild = listChild.nextSibling;
          }
        } else if (indexChild.name === 'Expression') {
          // Fallback for grammar without IndexList
          arrayIndices.push(parseExpression(indexChild, source));
        }
        indexChild = indexChild.nextSibling;
      }
    }
    child = child.nextSibling;
  }

  const name = accessPath.join('.');
  const result: STVariable = { type: 'Variable', name, accessPath, loc };

  if (arrayIndices.length > 0) {
    result.arrayIndices = arrayIndices;
  }

  return result;
}

function parseLiteral(node: SyntaxNode, source: string): STLiteral {
  const loc = { start: node.from, end: node.to };

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'HexNumber': {
        const hexText = source.slice(child.from, child.to);
        // Parse 16#FF format - extract digits after 16#
        const hexDigits = hexText.slice(3); // Remove "16#"
        const hexValue = parseInt(hexDigits, 16);
        return {
          type: 'Literal',
          value: hexValue,
          literalType: 'INT',
          rawValue: hexText,
          loc,
        };
      }
      case 'BinaryNumber': {
        const binText = source.slice(child.from, child.to);
        // Parse 2#1010 format - extract digits after 2# and remove underscores
        const binDigits = binText.slice(2).replace(/_/g, ''); // Remove "2#" and underscores
        const binValue = parseInt(binDigits, 2);
        return {
          type: 'Literal',
          value: binValue,
          literalType: 'INT',
          rawValue: binText,
          loc,
        };
      }
      case 'Number': {
        const numText = source.slice(child.from, child.to);
        const numValue = numText.includes('.') ? parseFloat(numText) : parseInt(numText, 10);
        return {
          type: 'Literal',
          value: numValue,
          literalType: numText.includes('.') ? 'REAL' : 'INT',
          rawValue: numText,
          loc,
        };
      }
      case 'Boolean': {
        const boolText = source.slice(child.from, child.to).toUpperCase();
        return {
          type: 'Literal',
          value: boolText === 'TRUE',
          literalType: 'BOOL',
          rawValue: boolText,
          loc,
        };
      }
      case 'String': {
        const strText = source.slice(child.from, child.to);
        // Remove quotes
        const strValue = strText.slice(1, -1);
        return {
          type: 'Literal',
          value: strValue,
          literalType: 'STRING',
          rawValue: strText,
          loc,
        };
      }
      case 'TimeLiteral': {
        const timeText = source.slice(child.from, child.to);
        return {
          type: 'Literal',
          value: timeText,
          literalType: 'TIME',
          rawValue: timeText,
          loc,
        };
      }
      case 'DateLiteral': {
        const dateText = source.slice(child.from, child.to);
        return {
          type: 'Literal',
          value: dateText,
          literalType: 'DATE',
          rawValue: dateText,
          loc,
        };
      }
      case 'TimeOfDayLiteral': {
        const todText = source.slice(child.from, child.to);
        return {
          type: 'Literal',
          value: todText,
          literalType: 'TIME_OF_DAY',
          rawValue: todText,
          loc,
        };
      }
      case 'DateAndTimeLiteral': {
        const dtText = source.slice(child.from, child.to);
        return {
          type: 'Literal',
          value: dtText,
          literalType: 'DATE_AND_TIME',
          rawValue: dtText,
          loc,
        };
      }
      case 'QualifiedEnumValue': {
        // QualifiedEnumValue contains two Identifiers: TypeName#ValueName
        // e.g., TrafficLight#Yellow
        const identifiers: string[] = [];
        let enumChild = child.firstChild;
        while (enumChild) {
          if (enumChild.name === 'Identifier') {
            identifiers.push(source.slice(enumChild.from, enumChild.to));
          }
          enumChild = enumChild.nextSibling;
        }
        // Build qualified name: TypeName#ValueName
        const qualifiedName = identifiers.join('#');
        return {
          type: 'Literal',
          value: qualifiedName,
          literalType: 'ENUM',
          rawValue: qualifiedName,
          loc,
        };
      }
    }
    child = child.nextSibling;
  }

  // Fallback
  return { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
}

function parseFunctionCallExpr(node: SyntaxNode, source: string): STFunctionCall {
  const loc = { start: node.from, end: node.to };
  let name = '';
  const args: STExpression[] = [];

  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case 'Identifier':
        name = source.slice(child.from, child.to);
        break;
      case 'ArgumentList':
        args.push(...parseArgumentList(child, source));
        break;
    }
    child = child.nextSibling;
  }

  return { type: 'FunctionCall', name, arguments: args, loc };
}

function parseArgumentList(node: SyntaxNode, source: string): STExpression[] {
  const args: STExpression[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Expression') {
      args.push(parseExpression(child, source));
    }
    child = child.nextSibling;
  }
  return args;
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseBinaryChain(
  node: SyntaxNode,
  source: string,
  childType: string,
  operator: BinaryOperator
): STExpression {
  const loc = { start: node.from, end: node.to };
  const operands: STExpression[] = [];

  let child = node.firstChild;
  while (child) {
    if (child.name === childType) {
      switch (childType) {
        case 'AndExpression':
          operands.push(parseAndExpression(child, source));
          break;
        case 'XorExpression':
          operands.push(parseXorExpression(child, source));
          break;
        case 'CompareExpression':
          operands.push(parseCompareExpression(child, source));
          break;
      }
    }
    child = child.nextSibling;
  }

  if (operands.length === 0) {
    return { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
  }

  if (operands.length === 1) {
    return operands[0];
  }

  // Build left-associative chain
  let result = operands[0];
  for (let i = 1; i < operands.length; i++) {
    result = {
      type: 'BinaryExpr',
      operator,
      left: result,
      right: operands[i],
      loc,
    };
  }
  return result;
}

function buildLeftAssociativeExpr(
  parts: { expr: STExpression; op?: BinaryOperator }[],
  loc: SourceLocation
): STExpression {
  if (parts.length === 0) {
    return { type: 'Literal', value: 0, literalType: 'INT', rawValue: '0', loc };
  }

  let result = parts[0].expr;
  for (let i = 0; i < parts.length - 1; i++) {
    const op = parts[i].op;
    if (op && parts[i + 1]) {
      result = {
        type: 'BinaryExpr',
        operator: op,
        left: result,
        right: parts[i + 1].expr,
        loc,
      };
    }
  }
  return result;
}

function parseExpressionNode(node: SyntaxNode, source: string): STExpression {
  const loc = { start: node.from, end: node.to };
  switch (node.name) {
    case 'OrExpression':
      return parseOrExpression(node, source);
    case 'AndExpression':
      return parseAndExpression(node, source);
    case 'XorExpression':
      return parseXorExpression(node, source);
    case 'CompareExpression':
      return parseCompareExpression(node, source);
    case 'AddExpression':
      return parseAddExpression(node, source);
    case 'MulExpression':
      return parseMulExpression(node, source);
    case 'PowerExpression':
      return parsePowerExpression(node, source);
    case 'UnaryExpression':
      return parseUnaryExpression(node, source);
    case 'PrimaryExpression':
      return parsePrimaryExpression(node, source);
    case 'Variable':
      return parseVariable(node, source);
    case 'Literal':
      return parseLiteral(node, source);
    case 'FunctionCall':
      return parseFunctionCallExpr(node, source);
    default:
      return { type: 'Literal', value: false, literalType: 'BOOL', rawValue: 'FALSE', loc };
  }
}
