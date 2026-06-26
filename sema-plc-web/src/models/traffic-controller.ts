/**
 * Traffic Controller Model
 *
 * Defines the state machine and configuration for traffic light control.
 * All behavior is determined by the ladder diagram and structured text.
 */

// ============================================================================
// Traffic Light State
// ============================================================================

export interface TrafficLightState {
  red: boolean;
  yellow: boolean;
  green: boolean;
}

// ============================================================================
// Direction
// ============================================================================

export type Direction = 'north' | 'south' | 'east' | 'west';

export const ALL_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

// ============================================================================
// Traffic Phase
// ============================================================================

export interface TrafficPhase {
  id: string;
  name: string;
  duration: number; // milliseconds
  lights: Record<Direction, TrafficLightState>;
}

// ============================================================================
// Default 4-Way Intersection Phases
// ============================================================================

export const DEFAULT_4WAY_PHASES: TrafficPhase[] = [
  {
    id: 'phase_1',
    name: 'North-South Green',
    duration: 60000, // 60 seconds
    lights: {
      north: { red: false, yellow: false, green: true },
      south: { red: false, yellow: false, green: true },
      east: { red: true, yellow: false, green: false },
      west: { red: true, yellow: false, green: false },
    },
  },
  {
    id: 'phase_2',
    name: 'North-South Yellow',
    duration: 5000, // 5 seconds
    lights: {
      north: { red: false, yellow: true, green: false },
      south: { red: false, yellow: true, green: false },
      east: { red: true, yellow: false, green: false },
      west: { red: true, yellow: false, green: false },
    },
  },
  {
    id: 'phase_3',
    name: 'East-West Green',
    duration: 60000, // 60 seconds
    lights: {
      north: { red: true, yellow: false, green: false },
      south: { red: true, yellow: false, green: false },
      east: { red: false, yellow: false, green: true },
      west: { red: false, yellow: false, green: true },
    },
  },
  {
    id: 'phase_4',
    name: 'East-West Yellow',
    duration: 5000, // 5 seconds
    lights: {
      north: { red: true, yellow: false, green: false },
      south: { red: true, yellow: false, green: false },
      east: { red: false, yellow: true, green: false },
      west: { red: false, yellow: true, green: false },
    },
  },
];

// ============================================================================
// Intersection Configuration
// ============================================================================

export interface IntersectionConfig {
  id: string;
  name: string;
  position: { x: number; y: number }; // Grid position for multi-intersection layout
  phases: TrafficPhase[];
  currentPhase: number;
}

// ============================================================================
// Multi-Intersection Network
// ============================================================================

export interface CoordinationConfig {
  fromIntersection: string;
  toIntersection: string;
  offset: number; // Phase offset in milliseconds (for green wave)
}

export interface IntersectionNetwork {
  id: string;
  name: string;
  intersections: IntersectionConfig[];
  coordination: CoordinationConfig[];
  masterCycleTime: number; // Total cycle time in ms
}

// ============================================================================
// Traffic Controller Variables
// ============================================================================

export interface TrafficControllerVariables {
  // Inputs
  startButton: string;
  stopButton: string;
  emergencyStop: string;
  pedestrianRequests: Record<Direction, string>;

  // Outputs per direction
  lights: Record<Direction, {
    red: string;
    yellow: string;
    green: string;
  }>;

  // Internal timers
  phaseTimers: string[];

  // State variables
  currentPhase: string;
  isRunning: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Generate default variable names for a single intersection
 */
export function generateTrafficVariables(intersectionId: string): TrafficControllerVariables {
  const prefix = intersectionId.toUpperCase();

  return {
    startButton: `${prefix}_START`,
    stopButton: `${prefix}_STOP`,
    emergencyStop: `${prefix}_ESTOP`,
    pedestrianRequests: {
      north: `${prefix}_PED_N`,
      south: `${prefix}_PED_S`,
      east: `${prefix}_PED_E`,
      west: `${prefix}_PED_W`,
    },
    lights: {
      north: {
        red: `${prefix}_N_RED`,
        yellow: `${prefix}_N_YEL`,
        green: `${prefix}_N_GRN`,
      },
      south: {
        red: `${prefix}_S_RED`,
        yellow: `${prefix}_S_YEL`,
        green: `${prefix}_S_GRN`,
      },
      east: {
        red: `${prefix}_E_RED`,
        yellow: `${prefix}_E_YEL`,
        green: `${prefix}_E_GRN`,
      },
      west: {
        red: `${prefix}_W_RED`,
        yellow: `${prefix}_W_YEL`,
        green: `${prefix}_W_GRN`,
      },
    },
    phaseTimers: [
      `${prefix}_TMR_PH1`,
      `${prefix}_TMR_PH2`,
      `${prefix}_TMR_PH3`,
      `${prefix}_TMR_PH4`,
    ],
    currentPhase: `${prefix}_PHASE`,
    isRunning: `${prefix}_RUN`,
  };
}

/**
 * Create a default single intersection configuration
 */
export function createDefaultIntersection(id: string, name: string): IntersectionConfig {
  return {
    id,
    name,
    position: { x: 0, y: 0 },
    phases: [...DEFAULT_4WAY_PHASES],
    currentPhase: 0,
  };
}

/**
 * Create a default 4x4 intersection network
 */
export function createDefaultNetwork(): IntersectionNetwork {
  const intersections: IntersectionConfig[] = [];
  const coordination: CoordinationConfig[] = [];

  // Create 4 intersections in a 2x2 grid
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const id = `INT_${row}_${col}`;
      intersections.push({
        id,
        name: `Intersection ${row * 2 + col + 1}`,
        position: { x: col, y: row },
        phases: [...DEFAULT_4WAY_PHASES],
        currentPhase: 0,
      });
    }
  }

  // Add coordination for horizontal green wave
  // East-West traffic gets offset timing
  coordination.push(
    { fromIntersection: 'INT_0_0', toIntersection: 'INT_0_1', offset: 10000 },
    { fromIntersection: 'INT_1_0', toIntersection: 'INT_1_1', offset: 10000 }
  );

  return {
    id: 'default_network',
    name: 'Default 4-Way Network',
    intersections,
    coordination,
    masterCycleTime: 130000, // 60+5+60+5 = 130 seconds
  };
}

/**
 * Get all red state (emergency/stopped state)
 */
export function getAllRedState(): Record<Direction, TrafficLightState> {
  return {
    north: { red: true, yellow: false, green: false },
    south: { red: true, yellow: false, green: false },
    east: { red: true, yellow: false, green: false },
    west: { red: true, yellow: false, green: false },
  };
}

/**
 * Calculate total cycle time for an intersection
 */
export function calculateCycleTime(intersection: IntersectionConfig): number {
  return intersection.phases.reduce((sum, phase) => sum + phase.duration, 0);
}
