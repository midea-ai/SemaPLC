/**
 * Project File Structure
 *
 * Source of Truth: Structured Text (ST)
 * The visual editor renders from ST, and edits are saved back to ST.
 */

import type { VariableDeclaration } from './plc-types';
import type { LadderDiagram } from './ladder-elements';
import type { IntersectionNetwork } from './traffic-controller';

// Example ST stubs (removed Vite ?raw imports; plc-vis-web loads ST from the server API)
const trafficControllerST = '';
const dualPumpControllerST = '';

// ============================================================================
// Project Metadata
// ============================================================================

export interface ProjectMetadata {
  version: string;
  name: string;
  description?: string;
  author?: string;
  created: string;  // ISO date string
  modified: string; // ISO date string
  editorVersion: string;
}

// ============================================================================
// Program Unit
// ============================================================================

export interface ProgramUnit {
  id: string;
  name: string;
  type: 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION';

  // ST is source of truth
  structuredText: string;

  // Ladder representation (derived from ST)
  ladder?: LadderDiagram;

  // Sync state
  lastSyncSource: 'ladder' | 'st';
  syncValid: boolean;

  // Local variables
  variables: VariableDeclaration[];
}

// ============================================================================
// Project Configuration
// ============================================================================

export interface TrafficControllerConfig {
  type: 'traffic-controller';
  network: IntersectionNetwork;
}

export type ProjectConfiguration = TrafficControllerConfig;

// ============================================================================
// Complete Project
// ============================================================================

export interface LadderProject {
  meta: ProjectMetadata;
  programs: ProgramUnit[];
  globalVariables: VariableDeclaration[];
  configuration?: ProjectConfiguration;
}

// ============================================================================
// Project File Format (JSON)
// ============================================================================

export const PROJECT_FILE_EXTENSION = '.ladderproj';
export const EDITOR_VERSION = '1.0.0';

export interface ProjectFile {
  $schema: string;
  project: LadderProject;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createNewProject(name: string): LadderProject {
  const now = new Date().toISOString();

  return {
    meta: {
      version: '1.0',
      name,
      created: now,
      modified: now,
      editorVersion: EDITOR_VERSION,
    },
    programs: [
      createNewProgram('Main', 'PROGRAM'),
    ],
    globalVariables: [],
  };
}

export function createNewProgram(
  name: string,
  type: 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION'
): ProgramUnit {
  return {
    id: `program_${Date.now()}`,
    name,
    type,
    structuredText: getDefaultProgramTemplate(name, type),
    lastSyncSource: 'st',
    syncValid: true,
    variables: [],
  };
}

function getDefaultProgramTemplate(
  name: string,
  type: 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION'
): string {
  return `${type} ${name}

VAR_INPUT
    (* Input variables *)
END_VAR

VAR_OUTPUT
    (* Output variables *)
END_VAR

VAR
    (* Local variables *)
END_VAR

(* Program logic *)

END_${type}
`;
}

/**
 * Create a traffic controller program with default ST code
 * ST code is loaded from src/examples/traffic-controller.st at build time
 */
export function createTrafficControllerProgram(): ProgramUnit {
  return {
    id: 'traffic_controller_main',
    name: 'TrafficController',
    type: 'PROGRAM',
    structuredText: trafficControllerST,
    lastSyncSource: 'st',
    syncValid: true,
    variables: [],
  };
}

/**
 * Create a dual pump controller program with default ST code
 * ST code is loaded from src/examples/dual-pump-controller.st at build time
 * See specs/PUMP_EXAMPLE_SPEC.md for full specification.
 */
export function createDualPumpControllerProgram(): ProgramUnit {
  return {
    id: 'dual_pump_controller_main',
    name: 'DualPumpController',
    type: 'PROGRAM',
    structuredText: dualPumpControllerST,
    lastSyncSource: 'st',
    syncValid: true,
    variables: [],
  };
}

// (Re-exports of plc-types, ladder-elements, traffic-controller are in index.ts)
