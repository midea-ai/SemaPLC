/**
 * Structured Text Documentation Data
 *
 * Provides comprehensive documentation for autocomplete and hover tooltips.
 * Includes signatures, descriptions, parameters, examples, and links.
 *
 * Phase 2: In-Context Help Implementation
 */

// ============================================================================
// Types
// ============================================================================

export interface STDocumentation {
  signature?: string;
  description: string;
  parameters?: ParameterDoc[];
  returns?: ReturnDoc[];
  example?: string;
  seeAlso?: string[];
  docsLink?: string;
}

export interface ParameterDoc {
  name: string;
  type: string;
  description: string;
}

export interface ReturnDoc {
  name: string;
  type: string;
  description: string;
}

// ============================================================================
// Function Block Documentation
// ============================================================================

export const FUNCTION_BLOCK_DOCS: Record<string, STDocumentation> = {
  // Timers
  TON: {
    signature: 'TON(IN: BOOL, PT: TIME)',
    description:
      'On-delay timer. Output Q becomes TRUE after input IN has been continuously TRUE for the preset time PT.',
    parameters: [
      { name: 'IN', type: 'BOOL', description: 'Timer start input. Timer runs while IN is TRUE.' },
      { name: 'PT', type: 'TIME', description: 'Preset time. Duration before Q becomes TRUE.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Done output. TRUE when elapsed time >= preset time.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time. Current timer value (0 to PT).' },
    ],
    example: `DelayTimer(IN := StartBtn, PT := T#5s);
IF DelayTimer.Q THEN
  Motor := TRUE;
END_IF;`,
    seeAlso: ['TOF', 'TP'],
    docsLink: '/docs/function-blocks/timers/ton',
  },

  TOF: {
    signature: 'TOF(IN: BOOL, PT: TIME)',
    description:
      'Off-delay timer. Output Q stays TRUE for preset time PT after input IN goes FALSE.',
    parameters: [
      { name: 'IN', type: 'BOOL', description: 'Timer input. Q stays TRUE while IN is TRUE or timer is running.' },
      { name: 'PT', type: 'TIME', description: 'Preset time. Duration Q stays TRUE after IN goes FALSE.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Output. TRUE while IN is TRUE or during off-delay.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since IN went FALSE.' },
    ],
    example: `OffDelay(IN := FanRequest, PT := T#10s);
FanMotor := OffDelay.Q;  (* Fan runs 10s after request stops *)`,
    seeAlso: ['TON', 'TP'],
    docsLink: '/docs/function-blocks/timers/tof',
  },

  TP: {
    signature: 'TP(IN: BOOL, PT: TIME)',
    description:
      'Pulse timer. Generates a pulse of fixed duration PT on rising edge of IN.',
    parameters: [
      { name: 'IN', type: 'BOOL', description: 'Trigger input. Rising edge starts the pulse.' },
      { name: 'PT', type: 'TIME', description: 'Pulse width. Duration of the output pulse.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Pulse output. TRUE for duration PT after trigger.' },
      { name: 'ET', type: 'TIME', description: 'Elapsed time since pulse started.' },
    ],
    example: `PulseGen(IN := TriggerBtn, PT := T#500ms);
Buzzer := PulseGen.Q;  (* 500ms beep on button press *)`,
    seeAlso: ['TON', 'TOF'],
    docsLink: '/docs/function-blocks/timers/tp',
  },

  // Counters
  CTU: {
    signature: 'CTU(CU: BOOL, R: BOOL, PV: INT)',
    description:
      'Count up counter. Increments CV on each rising edge of CU. Q is TRUE when CV >= PV.',
    parameters: [
      { name: 'CU', type: 'BOOL', description: 'Count up input. Increments CV on rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset input. Sets CV to 0 when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value. Target count for Q output.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Done output. TRUE when CV >= PV.' },
      { name: 'CV', type: 'INT', description: 'Current value. Current count (0 to PV+).' },
    ],
    example: `PartsCounter(CU := PartSensor, R := ResetBtn, PV := 100);
IF PartsCounter.Q THEN
  BatchComplete := TRUE;
END_IF;`,
    seeAlso: ['CTD', 'CTUD'],
    docsLink: '/docs/function-blocks/counters/ctu',
  },

  CTD: {
    signature: 'CTD(CD: BOOL, LD: BOOL, PV: INT)',
    description:
      'Count down counter. Decrements CV on each rising edge of CD. Q is TRUE when CV <= 0.',
    parameters: [
      { name: 'CD', type: 'BOOL', description: 'Count down input. Decrements CV on rising edge.' },
      { name: 'LD', type: 'BOOL', description: 'Load input. Sets CV to PV when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value. Initial count loaded by LD.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Done output. TRUE when CV <= 0.' },
      { name: 'CV', type: 'INT', description: 'Current value. Current count (PV down to 0).' },
    ],
    example: `RemainingParts(CD := PartRemoved, LD := LoadBatch, PV := 50);
IF RemainingParts.Q THEN
  ContainerEmpty := TRUE;
END_IF;`,
    seeAlso: ['CTU', 'CTUD'],
    docsLink: '/docs/function-blocks/counters/ctd',
  },

  CTUD: {
    signature: 'CTUD(CU: BOOL, CD: BOOL, R: BOOL, LD: BOOL, PV: INT)',
    description:
      'Count up/down counter. Combines CTU and CTD functionality. Can count in both directions.',
    parameters: [
      { name: 'CU', type: 'BOOL', description: 'Count up input. Increments CV on rising edge.' },
      { name: 'CD', type: 'BOOL', description: 'Count down input. Decrements CV on rising edge.' },
      { name: 'R', type: 'BOOL', description: 'Reset input. Sets CV to 0 when TRUE.' },
      { name: 'LD', type: 'BOOL', description: 'Load input. Sets CV to PV when TRUE.' },
      { name: 'PV', type: 'INT', description: 'Preset value for QU comparison and LD operation.' },
    ],
    returns: [
      { name: 'QU', type: 'BOOL', description: 'Up output. TRUE when CV >= PV.' },
      { name: 'QD', type: 'BOOL', description: 'Down output. TRUE when CV <= 0.' },
      { name: 'CV', type: 'INT', description: 'Current value. Current count.' },
    ],
    example: `Inventory(CU := ItemIn, CD := ItemOut, R := FALSE, LD := FALSE, PV := 100);
OverStock := Inventory.QU;  (* TRUE when >= 100 items *)
OutOfStock := Inventory.QD;  (* TRUE when <= 0 items *)`,
    seeAlso: ['CTU', 'CTD'],
    docsLink: '/docs/function-blocks/counters/ctud',
  },

  // Edge detection
  R_TRIG: {
    signature: 'R_TRIG(CLK: BOOL)',
    description:
      'Rising edge detector. Output Q is TRUE for one scan cycle when input CLK transitions from FALSE to TRUE.',
    parameters: [
      { name: 'CLK', type: 'BOOL', description: 'Clock input to monitor for rising edge.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Output. TRUE for one scan on rising edge.' },
    ],
    example: `ButtonEdge(CLK := PushButton);
IF ButtonEdge.Q THEN
  Counter := Counter + 1;  (* Count button presses *)
END_IF;`,
    seeAlso: ['F_TRIG'],
    docsLink: '/docs/function-blocks/edge/r-trig',
  },

  F_TRIG: {
    signature: 'F_TRIG(CLK: BOOL)',
    description:
      'Falling edge detector. Output Q is TRUE for one scan cycle when input CLK transitions from TRUE to FALSE.',
    parameters: [
      { name: 'CLK', type: 'BOOL', description: 'Clock input to monitor for falling edge.' },
    ],
    returns: [
      { name: 'Q', type: 'BOOL', description: 'Output. TRUE for one scan on falling edge.' },
    ],
    example: `ReleaseEdge(CLK := HoldButton);
IF ReleaseEdge.Q THEN
  ItemReleased := TRUE;  (* Trigger on button release *)
END_IF;`,
    seeAlso: ['R_TRIG'],
    docsLink: '/docs/function-blocks/edge/f-trig',
  },

  // Bistables
  SR: {
    signature: 'SR(S1: BOOL, R: BOOL)',
    description:
      'Set-dominant bistable. Sets Q1 when S1 is TRUE. Resets when R is TRUE and S1 is FALSE. Set has priority.',
    parameters: [
      { name: 'S1', type: 'BOOL', description: 'Set input. Sets Q1 when TRUE (dominant).' },
      { name: 'R', type: 'BOOL', description: 'Reset input. Resets Q1 when TRUE and S1 is FALSE.' },
    ],
    returns: [
      { name: 'Q1', type: 'BOOL', description: 'Output. Latched state.' },
    ],
    example: `Latch(S1 := StartBtn, R := StopBtn);
MotorRunning := Latch.Q1;`,
    seeAlso: ['RS'],
    docsLink: '/docs/function-blocks/bistable/sr',
  },

  RS: {
    signature: 'RS(S: BOOL, R1: BOOL)',
    description:
      'Reset-dominant bistable. Sets Q1 when S is TRUE. Resets when R1 is TRUE. Reset has priority.',
    parameters: [
      { name: 'S', type: 'BOOL', description: 'Set input. Sets Q1 when TRUE.' },
      { name: 'R1', type: 'BOOL', description: 'Reset input. Resets Q1 when TRUE (dominant).' },
    ],
    returns: [
      { name: 'Q1', type: 'BOOL', description: 'Output. Latched state.' },
    ],
    example: `SafetyLatch(S := EnableBtn, R1 := EStop);
SystemEnabled := SafetyLatch.Q1;  (* E-Stop always wins *)`,
    seeAlso: ['SR'],
    docsLink: '/docs/function-blocks/bistable/rs',
  },
};

// ============================================================================
// Data Type Documentation
// ============================================================================

export const DATA_TYPE_DOCS: Record<string, STDocumentation> = {
  BOOL: {
    description: 'Boolean type. Can hold TRUE or FALSE values.',
    example: 'MotorRunning : BOOL := FALSE;',
    docsLink: '/docs/language/data-types#bool',
  },
  INT: {
    description: '16-bit signed integer. Range: -32,768 to 32,767.',
    example: 'Count : INT := 0;',
    docsLink: '/docs/language/data-types#int',
  },
  DINT: {
    description: '32-bit signed integer. Range: -2,147,483,648 to 2,147,483,647.',
    example: 'LargeCount : DINT := 0;',
    docsLink: '/docs/language/data-types#dint',
  },
  UINT: {
    description: '16-bit unsigned integer. Range: 0 to 65,535.',
    example: 'PositiveCount : UINT := 0;',
    docsLink: '/docs/language/data-types#uint',
  },
  REAL: {
    description: '32-bit floating point number. For decimal values and calculations.',
    example: 'Temperature : REAL := 0.0;',
    docsLink: '/docs/language/data-types#real',
  },
  TIME: {
    description: 'Duration type. Represents time intervals. Format: T#<value><unit>.',
    example: `Delay : TIME := T#5s;    (* 5 seconds *)
ShortDelay : TIME := T#100ms;  (* 100 milliseconds *)
LongDelay : TIME := T#1h30m;   (* 1 hour 30 minutes *)`,
    docsLink: '/docs/language/data-types#time',
  },
  STRING: {
    description: 'Text string type. Holds character sequences.',
    example: "Message : STRING := 'Hello World';",
    docsLink: '/docs/language/data-types#string',
  },
};

// ============================================================================
// Keyword Documentation
// ============================================================================

export const KEYWORD_DOCS: Record<string, STDocumentation> = {
  // Control flow
  IF: {
    signature: 'IF condition THEN statements END_IF',
    description: 'Conditional execution. Executes statements only when condition is TRUE.',
    example: `IF Temperature > 100.0 THEN
  Alarm := TRUE;
  Cooling := TRUE;
ELSIF Temperature > 80.0 THEN
  Warning := TRUE;
ELSE
  Alarm := FALSE;
END_IF;`,
    docsLink: '/docs/language/statements/if',
  },
  CASE: {
    signature: 'CASE expression OF value: statements END_CASE',
    description: 'Multi-way branch. Selects statements based on expression value.',
    example: `CASE State OF
  0: (* Idle *)
    Motor := FALSE;
  1: (* Running *)
    Motor := TRUE;
  2..5: (* Range match *)
    Speed := State * 10;
END_CASE;`,
    docsLink: '/docs/language/statements/case',
  },
  FOR: {
    signature: 'FOR var := start TO end [BY step] DO statements END_FOR',
    description: 'Counted loop. Repeats statements a fixed number of times.',
    example: `FOR i := 1 TO 10 DO
  Sum := Sum + i;
END_FOR;

(* With step *)
FOR j := 10 TO 0 BY -2 DO
  Array[j] := 0;
END_FOR;`,
    docsLink: '/docs/language/statements/for',
  },
  WHILE: {
    signature: 'WHILE condition DO statements END_WHILE',
    description: 'Pre-test loop. Repeats statements while condition is TRUE. May execute zero times.',
    example: `WHILE Count < 100 AND NOT Done DO
  ProcessItem();
  Count := Count + 1;
END_WHILE;`,
    docsLink: '/docs/language/statements/while',
  },
  REPEAT: {
    signature: 'REPEAT statements UNTIL condition END_REPEAT',
    description: 'Post-test loop. Repeats statements until condition is TRUE. Always executes at least once.',
    example: `REPEAT
  ReadSensor();
  Attempts := Attempts + 1;
UNTIL SensorOK OR Attempts >= 3 END_REPEAT;`,
    docsLink: '/docs/language/statements/repeat',
  },

  // Operators
  AND: {
    description: 'Logical AND operator. Returns TRUE if both operands are TRUE.',
    example: 'Result := A AND B;  (* TRUE only if both A and B are TRUE *)',
    docsLink: '/docs/language/operators#logical',
  },
  OR: {
    description: 'Logical OR operator. Returns TRUE if either operand is TRUE.',
    example: 'Result := A OR B;  (* TRUE if A or B or both are TRUE *)',
    docsLink: '/docs/language/operators#logical',
  },
  NOT: {
    description: 'Logical NOT operator. Inverts the boolean value.',
    example: 'Result := NOT A;  (* TRUE if A is FALSE *)',
    docsLink: '/docs/language/operators#logical',
  },
  XOR: {
    description: 'Logical XOR (exclusive OR) operator. Returns TRUE if exactly one operand is TRUE.',
    example: 'Result := A XOR B;  (* TRUE if A and B are different *)',
    docsLink: '/docs/language/operators#logical',
  },
  MOD: {
    description: 'Modulo operator. Returns remainder of integer division.',
    example: 'Remainder := 17 MOD 5;  (* Result: 2 *)',
    docsLink: '/docs/language/operators#arithmetic',
  },

  // Variable declarations
  VAR: {
    description: 'Declares local variables within a program or function block.',
    example: `VAR
  Counter : INT := 0;
  Active : BOOL;
  Timer1 : TON;
END_VAR`,
    docsLink: '/docs/language/variables',
  },
  VAR_INPUT: {
    description: 'Declares input parameters for a function block. Values passed in from caller.',
    example: `VAR_INPUT
  Enable : BOOL;
  SetPoint : REAL;
END_VAR`,
    docsLink: '/docs/language/variables#var_input',
  },
  VAR_OUTPUT: {
    description: 'Declares output parameters for a function block. Values returned to caller.',
    example: `VAR_OUTPUT
  Done : BOOL;
  Result : INT;
END_VAR`,
    docsLink: '/docs/language/variables#var_output',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get documentation for any ST symbol (function block, type, or keyword)
 */
export function getSTDocumentation(symbol: string): STDocumentation | undefined {
  const upperSymbol = symbol.toUpperCase();
  return (
    FUNCTION_BLOCK_DOCS[upperSymbol] ||
    DATA_TYPE_DOCS[upperSymbol] ||
    KEYWORD_DOCS[upperSymbol]
  );
}

/**
 * Format documentation as HTML for tooltip display
 */
export function formatDocumentationHTML(doc: STDocumentation): string {
  let html = '';

  if (doc.signature) {
    html += `<div class="doc-signature"><code>${escapeHTML(doc.signature)}</code></div>`;
  }

  html += `<div class="doc-description">${escapeHTML(doc.description)}</div>`;

  if (doc.parameters && doc.parameters.length > 0) {
    html += '<div class="doc-section"><strong>Parameters:</strong><ul>';
    for (const param of doc.parameters) {
      html += `<li><code>${param.name}</code> (${param.type}): ${escapeHTML(param.description)}</li>`;
    }
    html += '</ul></div>';
  }

  if (doc.returns && doc.returns.length > 0) {
    html += '<div class="doc-section"><strong>Returns:</strong><ul>';
    for (const ret of doc.returns) {
      html += `<li><code>${ret.name}</code> (${ret.type}): ${escapeHTML(ret.description)}</li>`;
    }
    html += '</ul></div>';
  }

  if (doc.example) {
    html += `<div class="doc-section"><strong>Example:</strong><pre>${escapeHTML(doc.example)}</pre></div>`;
  }

  if (doc.seeAlso && doc.seeAlso.length > 0) {
    html += `<div class="doc-see-also">See also: ${doc.seeAlso.join(', ')}</div>`;
  }

  return html;
}

/**
 * Format documentation as plain text for autocomplete info
 */
export function formatDocumentationText(doc: STDocumentation): string {
  let text = doc.description;

  if (doc.parameters && doc.parameters.length > 0) {
    text += '\n\nParameters:';
    for (const param of doc.parameters) {
      text += `\n• ${param.name} (${param.type}): ${param.description}`;
    }
  }

  if (doc.returns && doc.returns.length > 0) {
    text += '\n\nReturns:';
    for (const ret of doc.returns) {
      text += `\n• ${ret.name} (${ret.type}): ${ret.description}`;
    }
  }

  return text;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
