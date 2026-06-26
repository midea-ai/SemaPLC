/**
 * IEC 61131-3 PLC Data Types
 */

// Primitive data types
export type PLCPrimitiveType =
  | 'BOOL'
  | 'INT'
  | 'DINT'
  | 'UINT'
  | 'REAL'
  | 'TIME'
  | 'STRING';

// Function block types
export type PLCFunctionBlockType =
  | 'TON'   // On-delay timer
  | 'TOF'   // Off-delay timer
  | 'TP'    // Pulse timer
  | 'CTU'   // Count up
  | 'CTD'   // Count down
  | 'CTUD'; // Count up/down

export type PLCDataType = PLCPrimitiveType | PLCFunctionBlockType;

// Variable scope (IEC 61131-3)
export type VariableScope =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_TEMP';

// Time value representation
export interface TimeValue {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

/**
 * Parse a TIME literal string (e.g., "T#5s", "T#1h30m", "TIME#100ms")
 */
export function parseTimeLiteral(literal: string): TimeValue {
  const result: TimeValue = {};

  // Remove prefix
  const value = literal.replace(/^(T#|TIME#)/i, '');

  // Match each component
  const dayMatch = value.match(/(\d+)d/i);
  const hourMatch = value.match(/(\d+)h/i);
  const minMatch = value.match(/(\d+)m(?!s)/i);
  const secMatch = value.match(/(\d+)s(?!m)/i);
  const msMatch = value.match(/(\d+)ms/i);

  if (dayMatch) result.days = parseInt(dayMatch[1], 10);
  if (hourMatch) result.hours = parseInt(hourMatch[1], 10);
  if (minMatch) result.minutes = parseInt(minMatch[1], 10);
  if (secMatch) result.seconds = parseInt(secMatch[1], 10);
  if (msMatch) result.milliseconds = parseInt(msMatch[1], 10);

  return result;
}

/**
 * Convert TimeValue to milliseconds
 */
export function timeValueToMs(time: TimeValue): number {
  return (
    (time.days || 0) * 86400000 +
    (time.hours || 0) * 3600000 +
    (time.minutes || 0) * 60000 +
    (time.seconds || 0) * 1000 +
    (time.milliseconds || 0)
  );
}

/**
 * Convert milliseconds to TIME literal string
 */
export function msToTimeLiteral(ms: number): string {
  if (ms < 1000) {
    return `T#${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const remainingMs = ms % 1000;

  if (remainingMs === 0) {
    if (seconds < 60) {
      return `T#${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSecs = seconds % 60;
    if (remainingSecs === 0 && minutes < 60) {
      return `T#${minutes}m`;
    }
    if (remainingSecs === 0) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      if (remainingMins === 0) {
        return `T#${hours}h`;
      }
      return `T#${hours}h${remainingMins}m`;
    }
    return `T#${minutes}m${remainingSecs}s`;
  }

  return `T#${seconds}s${remainingMs}ms`;
}

// Variable declaration
export interface VariableDeclaration {
  name: string;
  dataType: PLCDataType;
  scope: VariableScope;
  initialValue?: string;
  comment?: string;
  address?: string; // I/O address like %IX0.0, %QX0.0
}

// Default values for data types
export function getDefaultValue(dataType: PLCDataType): string {
  switch (dataType) {
    case 'BOOL':
      return 'FALSE';
    case 'INT':
    case 'DINT':
    case 'UINT':
      return '0';
    case 'REAL':
      return '0.0';
    case 'TIME':
      return 'T#0ms';
    case 'STRING':
      return "''";
    default:
      return '';
  }
}
