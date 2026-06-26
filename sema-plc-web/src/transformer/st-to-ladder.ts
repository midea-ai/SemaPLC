/**
 * ST to Ladder Transformer
 *
 * Main entry point for transforming Structured Text to Ladder diagrams.
 * Orchestrates the conversion pipeline:
 * 1. Parse ST code to AST
 * 2. Convert AST to Ladder IR
 * 3. Layout the diagram
 * 4. Convert to React Flow nodes/edges
 */

import type { LadderNode, LadderEdge, LadderDiagram, LadderRung } from '../models/ladder-elements';
import type { VariableDeclaration } from '../models/plc-types';
import { parseSTToAST, type STAST } from './ast';
import { astToLadderIR, type LadderIR } from './ladder-ir';
import { layoutDiagram, type DiagramLayout } from './layout';
import { irToReactFlow } from './react-flow';

// ============================================================================
// Result Types
// ============================================================================

export interface TransformResult {
  success: boolean;
  /** The generated React Flow nodes */
  nodes: LadderNode[];
  /** The generated React Flow edges */
  edges: LadderEdge[];
  /** Variable declarations extracted from the ST code */
  variables: VariableDeclaration[];
  /** The complete ladder diagram structure */
  diagram?: LadderDiagram;
  /** The intermediate representations (for debugging) */
  intermediates?: {
    ast: STAST;
    ir: LadderIR;
    layout: DiagramLayout;
  };
  /** Errors that occurred during transformation */
  errors: TransformError[];
  /** Warnings that don't prevent transformation */
  warnings: TransformWarning[];
}

export interface TransformError {
  message: string;
  line?: number;
  column?: number;
  source?: string;
}

export interface TransformWarning {
  message: string;
  line?: number;
  source?: string;
}

export interface TransformOptions {
  /** Include intermediate representations in the result */
  includeIntermediates?: boolean;
  /** Generate warnings for unsupported constructs */
  warnOnUnsupported?: boolean;
}

// ============================================================================
// Main Transform Function
// ============================================================================

/**
 * Transform ST code to a ladder diagram.
 *
 * @param stCode - The Structured Text source code
 * @param options - Transformation options
 * @returns The transformation result with nodes, edges, and any errors
 */
export function transformSTToLadder(
  stCode: string,
  options: TransformOptions = {}
): TransformResult {
  const errors: TransformError[] = [];
  const warnings: TransformWarning[] = [];

  try {
    // Step 1: Parse ST code to AST
    const ast = parseSTToAST(stCode);

    // Collect parse errors
    for (const error of ast.errors) {
      errors.push({
        message: error.message,
        line: getLineNumber(stCode, error.loc.start),
        source: stCode.slice(error.loc.start, Math.min(error.loc.end, error.loc.start + 50)),
      });
    }

    // If there are parse errors, return early
    if (errors.length > 0) {
      return {
        success: false,
        nodes: [],
        edges: [],
        variables: [],
        errors,
        warnings,
      };
    }

    // Step 2: Convert AST to Ladder IR
    const ir = astToLadderIR(ast);

    // Generate warnings for unsupported constructs
    if (options.warnOnUnsupported) {
      collectUnsupportedWarnings(ast, warnings, stCode);
    }

    // Step 3: Layout the diagram
    const layout = layoutDiagram(ir);

    // Step 4: Convert to React Flow nodes/edges
    const { nodes, edges } = irToReactFlow(ir, layout);

    // Step 5: Extract variables
    const variables = extractVariables(ir);

    // Step 6: Build complete diagram structure
    const diagram = buildDiagram(ir, nodes, edges, variables);

    // Build result
    const result: TransformResult = {
      success: true,
      nodes,
      edges,
      variables,
      diagram,
      errors,
      warnings,
    };

    // Include intermediates if requested
    if (options.includeIntermediates) {
      result.intermediates = { ast, ir, layout };
    }

    return result;

  } catch (e) {
    errors.push({
      message: e instanceof Error ? e.message : 'Unknown transformation error',
    });

    return {
      success: false,
      nodes: [],
      edges: [],
      variables: [],
      errors,
      warnings,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getLineNumber(source: string, position: number): number {
  const lines = source.slice(0, position).split('\n');
  return lines.length;
}

function extractVariables(ir: LadderIR): VariableDeclaration[] {
  const variables: VariableDeclaration[] = [];

  for (const [_, info] of ir.variables) {
    // Convert VariableScopeKind to VariableScope (exclude VAR_GLOBAL, VAR_EXTERNAL)
    const validScopes = ['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP'] as const;
    const scope = validScopes.includes(info.scope as typeof validScopes[number])
      ? (info.scope as 'VAR' | 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT' | 'VAR_TEMP')
      : 'VAR';

    variables.push({
      name: info.name,
      dataType: info.dataType as 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME' | 'STRING',
      scope,
    });
  }

  return variables;
}

function buildDiagram(
  ir: LadderIR,
  nodes: LadderNode[],
  edges: LadderEdge[],
  variables: VariableDeclaration[]
): LadderDiagram {
  // Group nodes and edges by rung
  const rungs: LadderRung[] = ir.rungs.map(rungIR => {
    const rungNodes = nodes.filter(node => {
      const data = node.data as { rungIndex?: number };
      return data.rungIndex === rungIR.index;
    });

    const rungEdges = edges.filter(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const sourceData = sourceNode?.data as { rungIndex?: number };
      return sourceData?.rungIndex === rungIR.index;
    });

    return {
      id: rungIR.id,
      index: rungIR.index,
      comment: rungIR.comment,
      nodes: rungNodes,
      edges: rungEdges,
    };
  });

  return {
    id: `diagram_${Date.now()}`,
    name: ir.programName,
    version: '1.0',
    rungs,
    variables,
  };
}

function collectUnsupportedWarnings(
  ast: STAST,
  warnings: TransformWarning[],
  source: string
): void {
  // Check for unsupported constructs
  const checkStatements = (statements: Array<{ type: string; loc?: { start: number } }>) => {
    for (const stmt of statements) {
      if (stmt.type === 'ForStatement') {
        warnings.push({
          message: 'FOR loops cannot be directly represented in ladder logic. Consider using counters.',
          line: stmt.loc ? getLineNumber(source, stmt.loc.start) : undefined,
        });
      }
      if (stmt.type === 'WhileStatement') {
        warnings.push({
          message: 'WHILE loops cannot be directly represented in ladder logic.',
          line: stmt.loc ? getLineNumber(source, stmt.loc.start) : undefined,
        });
      }
      if (stmt.type === 'RepeatStatement') {
        warnings.push({
          message: 'REPEAT loops cannot be directly represented in ladder logic.',
          line: stmt.loc ? getLineNumber(source, stmt.loc.start) : undefined,
        });
      }
    }
  };

  for (const program of ast.programs) {
    checkStatements(program.statements as Array<{ type: string; loc?: { start: number } }>);
  }
  checkStatements(ast.topLevelStatements as Array<{ type: string; loc?: { start: number } }>);
}

// ============================================================================
// Reverse Transform (Ladder to ST) - Placeholder
// ============================================================================

/**
 * Transform a ladder diagram back to ST code.
 * This is a placeholder for future implementation.
 *
 * @param diagram - The ladder diagram to convert
 * @returns The generated ST code
 */
export function transformLadderToST(_diagram: LadderDiagram): string {
  // This would be implemented for full roundtrip support
  // For now, throw an error
  throw new Error('Ladder to ST transformation is not yet implemented');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Result of transforming ST straight to the Ladder IR (no layout / React Flow).
 * Used by the rung-card renderer (LadderRungView), which draws directly from the
 * logical IR rather than the laid-out node graph.
 */
export interface TransformIRResult {
  success: boolean;
  ir?: LadderIR;
  errors: TransformError[];
}

/**
 * Transform ST code to the Ladder IR only (parse + AST→IR). Stops before layout
 * and React Flow generation so consumers can render their own representation
 * (e.g. named rung cards) from the rung/inputNetwork/output structure.
 */
export function transformSTToLadderIR(stCode: string): TransformIRResult {
  const errors: TransformError[] = [];
  try {
    const ast = parseSTToAST(stCode);
    for (const error of ast.errors) {
      errors.push({
        message: error.message,
        line: getLineNumber(stCode, error.loc.start),
        source: stCode.slice(error.loc.start, Math.min(error.loc.end, error.loc.start + 50)),
      });
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }
    const ir = astToLadderIR(ast);
    return { success: true, ir, errors };
  } catch (e) {
    errors.push({ message: e instanceof Error ? e.message : 'Unknown transformation error' });
    return { success: false, errors };
  }
}

/**
 * Quick check if ST code can be transformed without errors.
 */
export function canTransform(stCode: string): boolean {
  const result = transformSTToLadder(stCode);
  return result.success;
}

/**
 * Get just the nodes and edges without the full result structure.
 */
export function getNodesAndEdges(
  stCode: string
): { nodes: LadderNode[]; edges: LadderEdge[] } | null {
  const result = transformSTToLadder(stCode);
  if (!result.success) {
    return null;
  }
  return { nodes: result.nodes, edges: result.edges };
}

/**
 * Get transformation errors only.
 */
export function getTransformErrors(stCode: string): TransformError[] {
  const result = transformSTToLadder(stCode);
  return result.errors;
}
