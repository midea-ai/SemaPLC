/**
 * Structured Text Language Support for CodeMirror 6
 *
 * Provides syntax highlighting, indentation, folding, and autocomplete for ST.
 */

import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  foldNodeProp,
  foldInside,
} from '@codemirror/language';
import { completeFromList, type Completion } from '@codemirror/autocomplete';
import { parser } from './st-parser';
import { stHighlighting } from './st-highlight';
import {
  FUNCTION_BLOCK_DOCS,
  DATA_TYPE_DOCS,
  KEYWORD_DOCS,
  formatDocumentationText,
} from './st-docs';

// ============================================================================
// Configure Parser with Metadata
// ============================================================================

const stParserWithMetadata = parser.configure({
  props: [
    stHighlighting,

    // Indentation rules
    indentNodeProp.add({
      ProgramDecl: (context) => context.column(context.node.from) + context.unit,
      FunctionBlockDecl: (context) => context.column(context.node.from) + context.unit,
      VarBlock: (context) => context.column(context.node.from) + context.unit,
      IfStatement: (context) => context.column(context.node.from) + context.unit,
      ElsifClause: (context) => context.column(context.node.from) + context.unit,
      ElseClause: (context) => context.column(context.node.from) + context.unit,
      CaseStatement: (context) => context.column(context.node.from) + context.unit,
      CaseClause: (context) => context.column(context.node.from) + context.unit,
      ForStatement: (context) => context.column(context.node.from) + context.unit,
      WhileStatement: (context) => context.column(context.node.from) + context.unit,
      RepeatStatement: (context) => context.column(context.node.from) + context.unit,
    }),

    // Code folding rules
    foldNodeProp.add({
      ProgramDecl: foldInside,
      FunctionBlockDecl: foldInside,
      VarBlock: foldInside,
      IfStatement: foldInside,
      CaseStatement: foldInside,
      ForStatement: foldInside,
      WhileStatement: foldInside,
      RepeatStatement: foldInside,
    }),
  ],
});

// ============================================================================
// Language Definition
// ============================================================================

export const stLanguage = LRLanguage.define({
  name: 'structured-text',
  parser: stParserWithMetadata,
  languageData: {
    commentTokens: {
      line: '//',
      block: { open: '(*', close: '*)' },
    },
    closeBrackets: {
      brackets: ['(', '[', '"', "'"],
    },
  },
});

// ============================================================================
// Helper: Create completion with documentation info
// ============================================================================

function createCompletion(
  label: string,
  type: string,
  detail?: string,
  apply?: string
): Completion {
  // Check for detailed documentation
  const doc =
    FUNCTION_BLOCK_DOCS[label] || DATA_TYPE_DOCS[label] || KEYWORD_DOCS[label];

  const completion: Completion = {
    label,
    type,
    detail: detail || (doc?.signature ? doc.signature.split('(')[0] : undefined),
  };

  // Add info function for extended documentation panel
  if (doc) {
    completion.info = () => {
      const container = document.createElement('div');
      container.className = 'cm-completion-info';
      container.innerHTML = formatDocumentationText(doc).replace(/\n/g, '<br>');
      return container;
    };
  }

  // Add apply for snippets
  if (apply) {
    completion.apply = apply;
  }

  return completion;
}

// ============================================================================
// Autocomplete Definitions
// ============================================================================

const keywords: Completion[] = [
  // Program structure
  createCompletion('PROGRAM', 'keyword', 'Program declaration'),
  createCompletion('END_PROGRAM', 'keyword'),
  createCompletion('FUNCTION_BLOCK', 'keyword', 'Function block declaration'),
  createCompletion('END_FUNCTION_BLOCK', 'keyword'),

  // Variable declarations
  createCompletion('VAR', 'keyword', 'Local variables'),
  createCompletion('VAR_INPUT', 'keyword', 'Input variables'),
  createCompletion('VAR_OUTPUT', 'keyword', 'Output variables'),
  createCompletion('VAR_IN_OUT', 'keyword', 'In/Out variables'),
  createCompletion('VAR_TEMP', 'keyword', 'Temporary variables'),
  createCompletion('END_VAR', 'keyword'),

  // Control flow
  createCompletion('IF', 'keyword'),
  createCompletion('THEN', 'keyword'),
  createCompletion('ELSIF', 'keyword'),
  createCompletion('ELSE', 'keyword'),
  createCompletion('END_IF', 'keyword'),
  createCompletion('CASE', 'keyword'),
  createCompletion('OF', 'keyword'),
  createCompletion('END_CASE', 'keyword'),
  createCompletion('FOR', 'keyword'),
  createCompletion('TO', 'keyword'),
  createCompletion('BY', 'keyword'),
  createCompletion('DO', 'keyword'),
  createCompletion('END_FOR', 'keyword'),
  createCompletion('WHILE', 'keyword'),
  createCompletion('END_WHILE', 'keyword'),
  createCompletion('REPEAT', 'keyword'),
  createCompletion('UNTIL', 'keyword'),
  createCompletion('END_REPEAT', 'keyword'),
  createCompletion('RETURN', 'keyword'),
  createCompletion('EXIT', 'keyword'),

  // Operators
  createCompletion('AND', 'keyword', 'Logical AND'),
  createCompletion('OR', 'keyword', 'Logical OR'),
  createCompletion('NOT', 'keyword', 'Logical NOT'),
  createCompletion('XOR', 'keyword', 'Logical XOR'),
  createCompletion('MOD', 'keyword', 'Modulo operator'),

  // Data types (with documentation from st-docs)
  createCompletion('BOOL', 'type', 'Boolean type'),
  createCompletion('INT', 'type', '16-bit signed integer'),
  createCompletion('DINT', 'type', '32-bit signed integer'),
  createCompletion('UINT', 'type', '16-bit unsigned integer'),
  createCompletion('REAL', 'type', '32-bit floating point'),
  createCompletion('TIME', 'type', 'Duration type'),
  createCompletion('STRING', 'type', 'String type'),

  // Timer function blocks (with detailed documentation)
  createCompletion('TON', 'type', 'On-delay timer'),
  createCompletion('TOF', 'type', 'Off-delay timer'),
  createCompletion('TP', 'type', 'Pulse timer'),

  // Counter function blocks (with detailed documentation)
  createCompletion('CTU', 'type', 'Count up counter'),
  createCompletion('CTD', 'type', 'Count down counter'),
  createCompletion('CTUD', 'type', 'Count up/down counter'),

  // Edge detection (with detailed documentation)
  createCompletion('R_TRIG', 'type', 'Rising edge detector'),
  createCompletion('F_TRIG', 'type', 'Falling edge detector'),

  // Bistables (with detailed documentation)
  createCompletion('SR', 'type', 'Set-dominant bistable'),
  createCompletion('RS', 'type', 'Reset-dominant bistable'),

  // Constants
  createCompletion('TRUE', 'constant', 'Boolean true'),
  createCompletion('FALSE', 'constant', 'Boolean false'),

  // Array
  createCompletion('ARRAY', 'keyword'),
];

// Snippets for common patterns
const snippets: Completion[] = [
  {
    label: 'IF-THEN-END_IF',
    type: 'snippet',
    detail: 'If statement',
    apply: 'IF ${condition} THEN\n    ${}\nEND_IF;',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Conditional execution block. Executes statements only when condition is TRUE.';
      return el;
    },
  },
  {
    label: 'IF-THEN-ELSE-END_IF',
    type: 'snippet',
    detail: 'If-else statement',
    apply: 'IF ${condition} THEN\n    ${}\nELSE\n    ${}\nEND_IF;',
  },
  {
    label: 'CASE-OF-END_CASE',
    type: 'snippet',
    detail: 'Case statement',
    apply: 'CASE ${expression} OF\n    0:\n        ${}\n    1:\n        ${}\nEND_CASE;',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Multi-way branch. Selects statements based on expression value. Supports integer ranges (e.g., 1..5).';
      return el;
    },
  },
  {
    label: 'FOR-DO-END_FOR',
    type: 'snippet',
    detail: 'For loop',
    apply: 'FOR ${i} := 0 TO 10 DO\n    ${}\nEND_FOR;',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Counted loop. Repeats statements a fixed number of times. Use BY clause for step values.';
      return el;
    },
  },
  {
    label: 'WHILE-DO-END_WHILE',
    type: 'snippet',
    detail: 'While loop',
    apply: 'WHILE ${condition} DO\n    ${}\nEND_WHILE;',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Pre-test loop. Repeats statements while condition is TRUE. May execute zero times.';
      return el;
    },
  },
  {
    label: 'REPEAT-UNTIL-END_REPEAT',
    type: 'snippet',
    detail: 'Repeat loop',
    apply: 'REPEAT\n    ${}\nUNTIL ${condition} END_REPEAT;',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Post-test loop. Repeats until condition is TRUE. Always executes at least once.';
      return el;
    },
  },
  {
    label: 'VAR-END_VAR',
    type: 'snippet',
    detail: 'Variable block',
    apply: 'VAR\n    ${name} : ${BOOL};\nEND_VAR',
  },
  {
    label: 'TON-timer',
    type: 'snippet',
    detail: 'TON timer call',
    apply: '${TimerName}(IN := ${condition}, PT := T#${5}s);',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'On-delay timer. Output Q becomes TRUE after IN has been TRUE for preset time PT.';
      return el;
    },
  },
  {
    label: 'CTU-counter',
    type: 'snippet',
    detail: 'CTU counter call',
    apply: '${CounterName}(CU := ${countInput}, R := ${reset}, PV := ${10});',
    info: () => {
      const el = document.createElement('div');
      el.className = 'cm-completion-info';
      el.textContent = 'Count up counter. Increments CV on rising edge of CU. Q is TRUE when CV >= PV.';
      return el;
    },
  },
];

const stCompletions = stLanguage.data.of({
  autocomplete: completeFromList([...keywords, ...snippets]),
});

// ============================================================================
// Language Support Export
// ============================================================================

export function structuredText(): LanguageSupport {
  return new LanguageSupport(stLanguage, [stCompletions]);
}

// Re-export parser for direct use
export { parser } from './st-parser';
