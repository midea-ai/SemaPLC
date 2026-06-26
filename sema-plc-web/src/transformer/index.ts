/**
 * ST to Ladder Transformer
 *
 * This module provides bidirectional conversion between IEC 61131-3
 * Structured Text and Ladder Logic diagrams.
 *
 * Main exports:
 * - transformSTToLadder: Convert ST code to React Flow nodes/edges
 * - validateLadderIR: Validate a ladder diagram
 *
 * The transformation pipeline:
 * 1. Parse ST -> AST (using Lezer parser)
 * 2. AST -> Ladder IR (intermediate representation)
 * 3. Layout IR -> positioned nodes
 * 4. IR -> React Flow nodes/edges
 *
 * Guiding principles enforced:
 * - Every output must be linked to its inputs
 * - All behavior is determined by the ladder/ST code
 * - Roundtrip fidelity is maintained
 */

// Main transformer
export {
  transformSTToLadder,
  transformLadderToST,
  canTransform,
  getNodesAndEdges,
  getTransformErrors,
  type TransformResult,
  type TransformError,
  type TransformWarning,
  type TransformOptions,
} from './st-to-ladder';

// AST types and parsing
export {
  parseSTToAST,
  type STAST,
  type STProgram,
  type STStatement,
  type STExpression,
  type STAssignment,
  type STFunctionBlockCall,
  type STIfStatement,
  type STVariable,
  type STLiteral,
  type STBinaryExpr,
  type STUnaryExpr,
  type ParseError,
} from './ast';

// Ladder IR types
export {
  astToLadderIR,
  expressionToContactNetwork,
  negateNetwork,
  type LadderIR,
  type LadderRungIR,
  type ContactNetwork,
  type SeriesNetwork,
  type ParallelNetwork,
  type ContactElement,
  type ComparatorElement,
  type RungOutput,
  type CoilOutput,
  type TimerOutput,
  type VariableInfo,
  type FunctionBlockInfo,
} from './ladder-ir';

// Layout
export {
  layoutDiagram,
  layoutRung,
  type DiagramLayout,
  type RungLayout,
  type LayoutNode,
  type LayoutEdge,
} from './layout';

// React Flow conversion
export {
  irToReactFlow,
  type ReactFlowResult,
} from './react-flow';

// Validation
export {
  validateLadderIR,
  validateOutputInputLinkage,
  validateVariableReferences,
  validatePowerFlow,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type ValidationErrorType,
  type ValidationWarningType,
} from './validation';
