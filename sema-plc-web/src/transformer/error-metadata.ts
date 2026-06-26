/**
 * Error Metadata Registry
 *
 * Provides suggestions, documentation links, and categorization for
 * transform errors and warnings.
 *
 * Phase 2: In-Context Help Implementation
 */

// ============================================================================
// Types
// ============================================================================

export interface ErrorMetadata {
  code: string;
  category: 'syntax' | 'semantic' | 'validation' | 'unsupported';
  suggestions: string[];
  documentationUrl?: string;
}

// ============================================================================
// Error Pattern Registry
// ============================================================================

/**
 * Maps error message patterns to metadata
 * Order matters - first match wins
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  metadata: ErrorMetadata;
}> = [
  // Syntax errors
  {
    pattern: /unexpected (token|character)/i,
    metadata: {
      code: 'SYN001',
      category: 'syntax',
      suggestions: [
        'Check for missing semicolons at the end of statements',
        'Verify all parentheses and brackets are balanced',
        'Ensure operators have operands on both sides',
      ],
      documentationUrl: '/docs/language/syntax',
    },
  },
  {
    pattern: /expected .*? but (got|found)/i,
    metadata: {
      code: 'SYN002',
      category: 'syntax',
      suggestions: [
        'Check the statement syntax against the language reference',
        'Verify keyword spelling (IF, THEN, END_IF, etc.)',
        'Ensure variable names start with a letter or underscore',
      ],
      documentationUrl: '/docs/language/syntax',
    },
  },

  // Variable errors
  {
    pattern: /undefined variable|undeclared variable/i,
    metadata: {
      code: 'VAR001',
      category: 'semantic',
      suggestions: [
        'Declare the variable in a VAR block before using it',
        'Check the variable name spelling (case-insensitive)',
        'Ensure the VAR block is before the code that uses the variable',
      ],
      documentationUrl: '/docs/language/variables',
    },
  },
  {
    pattern: /unused variable/i,
    metadata: {
      code: 'VAR002',
      category: 'validation',
      suggestions: [
        'Remove the variable if it\'s not needed',
        'Use the variable in your program logic',
        'This is a warning - your program will still work',
      ],
      documentationUrl: '/docs/language/variables',
    },
  },

  // Type errors
  {
    pattern: /type mismatch|incompatible types/i,
    metadata: {
      code: 'TYP001',
      category: 'semantic',
      suggestions: [
        'Ensure both sides of assignment have compatible types',
        'Use type conversion if needed (e.g., INT_TO_REAL)',
        'Check that boolean expressions result in BOOL type',
      ],
      documentationUrl: '/docs/language/data-types',
    },
  },

  // Timer/Counter errors
  {
    pattern: /timer/i,
    metadata: {
      code: 'FB001',
      category: 'semantic',
      suggestions: [
        'Declare timers with correct type (TON, TOF, or TP)',
        'Provide required parameters: IN and PT',
        'Access timer outputs with .Q (done) or .ET (elapsed time)',
      ],
      documentationUrl: '/docs/function-blocks/timers',
    },
  },
  {
    pattern: /counter/i,
    metadata: {
      code: 'FB002',
      category: 'semantic',
      suggestions: [
        'Declare counters with correct type (CTU, CTD, or CTUD)',
        'Provide required parameters based on counter type',
        'Access counter outputs with .Q (done) or .CV (current value)',
      ],
      documentationUrl: '/docs/function-blocks/counters',
    },
  },

  // Loop warnings
  {
    pattern: /FOR loops? cannot be (directly )?represented/i,
    metadata: {
      code: 'UNS001',
      category: 'unsupported',
      suggestions: [
        'Use a CTU counter with a preset value instead',
        'Implement loop logic across multiple scan cycles',
        'Consider if the operation can be done without iteration',
      ],
      documentationUrl: '/docs/function-blocks/counters/ctu',
    },
  },
  {
    pattern: /WHILE loops? cannot be (directly )?represented/i,
    metadata: {
      code: 'UNS002',
      category: 'unsupported',
      suggestions: [
        'Use state-based logic with IF statements',
        'Implement the loop condition check each scan cycle',
        'Consider using timers for time-based repetition',
      ],
      documentationUrl: '/docs/language/statements/while',
    },
  },
  {
    pattern: /REPEAT loops? cannot be (directly )?represented/i,
    metadata: {
      code: 'UNS003',
      category: 'unsupported',
      suggestions: [
        'Use state-based logic with IF statements',
        'The loop body will execute at least once per scan cycle',
        'Consider using timers or counters for repetition',
      ],
      documentationUrl: '/docs/language/statements/repeat',
    },
  },

  // Power flow errors
  {
    pattern: /power flow|orphaned output/i,
    metadata: {
      code: 'VAL001',
      category: 'validation',
      suggestions: [
        'Connect inputs to outputs in each rung',
        'Ensure there\'s a path from left rail to output',
        'Check that all contacts are properly connected',
      ],
      documentationUrl: '/docs/getting-started/ladder-basics',
    },
  },

  // Reference errors
  {
    pattern: /invalid reference|not found/i,
    metadata: {
      code: 'REF001',
      category: 'semantic',
      suggestions: [
        'Check that the referenced element exists',
        'Verify the name spelling matches exactly',
        'Ensure the element is declared before use',
      ],
      documentationUrl: '/docs/language/variables',
    },
  },
];

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Get metadata for an error message
 */
export function getErrorMetadata(message: string): ErrorMetadata | null {
  for (const { pattern, metadata } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return metadata;
    }
  }
  return null;
}

/**
 * Default metadata for unrecognized errors
 */
export const DEFAULT_ERROR_METADATA: ErrorMetadata = {
  code: 'ERR000',
  category: 'semantic',
  suggestions: [
    'Check the syntax of your statement',
    'Review the error message for specific details',
    'Consult the language reference documentation',
  ],
  documentationUrl: '/docs/language/reference',
};

/**
 * Default metadata for unrecognized warnings
 */
export const DEFAULT_WARNING_METADATA: ErrorMetadata = {
  code: 'WRN000',
  category: 'validation',
  suggestions: [
    'This warning indicates a potential issue',
    'Your program may still work correctly',
    'Consider reviewing the affected code',
  ],
  documentationUrl: '/docs/language/reference',
};

/**
 * Get category display name
 */
export function getCategoryDisplayName(
  category: ErrorMetadata['category']
): string {
  switch (category) {
    case 'syntax':
      return 'Syntax Error';
    case 'semantic':
      return 'Semantic Error';
    case 'validation':
      return 'Validation';
    case 'unsupported':
      return 'Unsupported Feature';
    default:
      return 'Error';
  }
}
