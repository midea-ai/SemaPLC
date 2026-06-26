/**
 * Structured Text Syntax Highlighting
 *
 * Defines highlighting rules for the ST language in CodeMirror.
 */

import { styleTags, tags as t } from '@lezer/highlight';

export const stHighlighting = styleTags({
  // Identifiers and variables
  Identifier: t.variableName,
  Variable: t.variableName,

  // Literals
  Number: t.number,
  Boolean: t.bool,
  String: t.string,
  TimeLiteral: t.literal,

  // Comments
  LineComment: t.lineComment,
  BlockComment: t.blockComment,

  // Control flow keywords
  'IF THEN ELSIF ELSE END_IF': t.controlKeyword,
  'CASE OF END_CASE': t.controlKeyword,
  'FOR TO BY DO END_FOR': t.controlKeyword,
  'WHILE END_WHILE': t.controlKeyword,
  'REPEAT UNTIL END_REPEAT': t.controlKeyword,
  'RETURN EXIT': t.controlKeyword,

  // Declaration keywords
  'PROGRAM END_PROGRAM': t.definitionKeyword,
  'FUNCTION_BLOCK END_FUNCTION_BLOCK': t.definitionKeyword,
  'VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_GLOBAL END_VAR': t.definitionKeyword,
  'ARRAY OF': t.definitionKeyword,

  // Type names
  'BOOL INT DINT UINT REAL TIME STRING': t.typeName,
  'TON TOF TP CTU CTD CTUD': t.typeName,

  // Operators
  'AND OR XOR NOT MOD': t.logicOperator,
  'CompareOp': t.compareOperator,
  ':=': t.definitionOperator,

  // Punctuation
  '"(" ")"': t.paren,
  '"[" "]"': t.squareBracket,
  '"{" "}"': t.brace,
  '","': t.separator,
  '";"': t.separator,
  '":"': t.punctuation,
  '"."': t.derefOperator,
  '".."': t.punctuation,

  // Arithmetic operators
  '"+" "-" "*" "/"': t.arithmeticOperator,
  '"=" "<>" "<" ">" "<=" ">="': t.compareOperator,
});
