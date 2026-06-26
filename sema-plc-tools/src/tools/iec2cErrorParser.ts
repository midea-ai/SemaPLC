// Maps opaque matiec (iec2c) error messages to actionable repair advice for the
// agent. matiec's diagnostics are terse and frequently point one line *after* the
// real cause, so the advice leans on the error's sourceLine and known matiec quirks.
// Empirically (325 benchmark sessions) the top failures are missing ';' after block
// terminators and the "invalid variable(s) declaration" family.

const BLOCK_TERMINATOR = /^\s*(END_IF|END_CASE|END_WHILE|END_FOR|END_REPEAT)\s*$/i

interface Pattern {
  regex: RegExp
  advice: (sourceLine: string) => string
}

const PATTERNS: Pattern[] = [
  {
    // #1 syntax error. matiec requires block terminators to be ';'-terminated
    // (END_IF; END_CASE; ...). It reports the missing ';' ON the terminator line,
    // which the agent often mistakes for the (already-terminated) preceding line.
    regex: /';'\s+missing\s+at\s+the\s+end\s+of\s+statement/i,
    advice: (src) =>
      BLOCK_TERMINATOR.test(src)
        ? `Add a trailing ';' after ${src.trim()} — matiec requires block terminators to be semicolon-terminated (END_IF;, END_CASE;, END_WHILE;, ...).`
        : `A statement is missing its trailing ';'. Check the end of this line (and note matiec also requires END_IF;/END_CASE;/END_WHILE; etc.).`,
  },
  {
    // The opaque #2 family. Two common root causes; the line is often valid-looking.
    regex: /invalid\s+(input\s+|output\s+)?variable\(s\)\s+declaration/i,
    advice: () =>
      `If this line looks syntactically valid, suspect: (a) the variable name collides with a matiec reserved/internal identifier (e.g. names like 'randomNumber') — try renaming it; or (b) an AT-located variable is mixed in the same VAR block as non-AT variables — split them into separate VAR blocks. matiec often reports this on the line AFTER the real cause.`,
  },
  {
    regex: /invalid\s+located\s+variable\s+declaration/i,
    advice: () =>
      `AT-location declaration error. BOOL must use bit notation (%IX0.0, not %IX0). Do not mix AT and non-AT variables in one VAR block.`,
  },
  {
    regex: /no\s+variable\s+declared\s+in\s+variable\(s\)\s+declaration/i,
    advice: () => `Empty or stray VAR section. Every VAR ... END_VAR block must declare at least one variable.`,
  },
  {
    regex: /bit\s+size\s+of\s+data\s+type\s+is\s+incompatible\s+with\s+bit\s+size\s+of\s+location/i,
    advice: () =>
      `The variable's type width doesn't match its AT location. Match them: BOOL↔%IX/%QX (bit), INT/WORD↔%IW/%QW (word), DINT/DWORD↔%ID/%QD (dword).`,
  },
  {
    regex: /(type\s+mismatch|incompatible\s+types?|data\s+type\s+mismatch)/i,
    advice: () =>
      `Type mismatch — matiec does not auto-coerce. Add an explicit conversion (INT_TO_REAL(x), BOOL_TO_INT(b), REAL_TO_INT(x), ...).`,
  },
  {
    regex: /(initial\s+value\s+has\s+incompatible\s+data\s+type|invalid\s+initial\s+value)/i,
    advice: () =>
      `The := initializer type doesn't match the declared type. E.g. a REAL must init as 0.0 not 0; a TIME as T#0s.`,
  },
  {
    regex: /invalid\s+variable\s+before\s+':='/i,
    advice: () => `Assignment target is not a declared variable. Check spelling and that it is declared in a VAR block.`,
  },
  {
    regex: /function\s+invocation\s+in\s+ST\s+code\s+is\s+not\s+allowed\s+outside\s+an\s+expression/i,
    advice: () => `A function/FB call must be used inside an expression or assignment, not as a bare statement.`,
  },
]

// Returns repair advice for an iec2c diagnostic, or undefined if no pattern matches.
export function adviceForIec2cError(message: string, sourceLine: string): string | undefined {
  for (const p of PATTERNS) {
    if (p.regex.test(message)) return p.advice(sourceLine)
  }
  return undefined
}
