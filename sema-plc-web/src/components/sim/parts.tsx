import type { ReactElement } from 'react'

// A library part is a pure SVG fragment with named anchors (data-anchor).
// The SimRuntime places it (outer <g transform>) and drives its anchors per bindings.
export type PartComponent = (params: Record<string, unknown>) => ReactElement

const Lamp: PartComponent = () => (
  <circle data-anchor="primary" cx="22" cy="22" r="18" fill="#9aa1ad" stroke="#333" strokeWidth="1.5" />
)

const SensorButton: PartComponent = () => (
  <g>
    <rect x="2" y="6" width="44" height="32" rx="6" fill="#0f1420" stroke="#333" />
    <circle data-anchor="primary" cx="24" cy="22" r="10" fill="#9aa1ad" stroke="#222" />
  </g>
)

const Valve: PartComponent = () => (
  <rect data-anchor="primary" x="6" y="6" width="36" height="36" rx="4" fill="#9aa1ad" stroke="#333" strokeWidth="1.5" />
)

const Cylinder: PartComponent = () => (
  <g>
    <rect x="0" y="14" width="34" height="20" rx="2" fill="#cfd4dd" stroke="#333" />
    {/* piston rod extends right when driven (translateX or fill) */}
    <rect data-anchor="primary" x="30" y="20" width="22" height="8" fill="#22c55e" stroke="#333" />
  </g>
)

const Motor: PartComponent = () => (
  <g data-anchor="primary" data-base-class="sim-rotor">
    <circle cx="22" cy="22" r="20" fill="#cfd4dd" stroke="#333" strokeWidth="1.5" />
    <rect x="20" y="2" width="4" height="20" fill="#384150" />
  </g>
)

const Conveyor: PartComponent = () => (
  <g>
    <rect x="0" y="20" width="120" height="14" rx="7" fill="#2b2f3a" stroke="#333" />
    <g data-anchor="primary" data-base-class="sim-belt">
      <line x1="10" y1="27" x2="20" y2="27" stroke="#6b7280" strokeWidth="2" />
      <line x1="40" y1="27" x2="50" y2="27" stroke="#6b7280" strokeWidth="2" />
      <line x1="70" y1="27" x2="80" y2="27" stroke="#6b7280" strokeWidth="2" />
      <line x1="100" y1="27" x2="110" y2="27" stroke="#6b7280" strokeWidth="2" />
    </g>
    <circle cx="8" cy="27" r="9" fill="#cfd4dd" stroke="#333" />
    <circle cx="112" cy="27" r="9" fill="#cfd4dd" stroke="#333" />
  </g>
)

const Tank: PartComponent = () => (
  <g>
    <rect x="6" y="2" width="40" height="60" rx="4" fill="#eef0f4" stroke="#333" strokeWidth="1.5" />
    {/* liquid grows UPWARD from the tank bottom: a local y-flip pins the rect's
        base at screen y=60, so the driven `height` extends toward the top. */}
    <rect data-anchor="primary" x="8" y="0" width="36" height="0" fill="#38bdf8" transform="translate(0,60) scale(1,-1)" />
  </g>
)

const NumericDisplay: PartComponent = () => (
  <g>
    <rect x="0" y="0" width="92" height="34" rx="4" fill="#0f1420" stroke="#333" />
    <text data-anchor="primary" x="46" y="23" fontSize="18" fontFamily="monospace" fill="#22c55e" textAnchor="middle">0</text>
  </g>
)

// Gauge: needle drawn at local (0,0), wrapped in <g translate(cx,cy)> so a bare
// rotate(N) (resolveEffect emits no cx/cy) pivots at the dial center. cx=cy=32 (64×64 box).
const Gauge: PartComponent = () => (
  <g>
    <circle cx="32" cy="32" r="30" fill="#eef0f4" stroke="#333" strokeWidth="1.5" />
    <circle cx="32" cy="32" r="3" fill="#384150" />
    <g transform="translate(32,32)">
      <line data-anchor="primary" x1="0" y1="0" x2="0" y2="-24" stroke="#e11d48" strokeWidth="2.5" />
    </g>
  </g>
)

const Pump: PartComponent = () => (
  <g>
    <circle cx="26" cy="26" r="24" fill="#cfd4dd" stroke="#333" strokeWidth="1.5" />
    <g data-anchor="primary" data-base-class="sim-rotor">
      <line x1="26" y1="26" x2="26" y2="6" stroke="#384150" strokeWidth="3" />
      <line x1="26" y1="26" x2="43" y2="36" stroke="#384150" strokeWidth="3" />
      <line x1="26" y1="26" x2="9" y2="36" stroke="#384150" strokeWidth="3" />
    </g>
    <circle cx="26" cy="26" r="4" fill="#0f1420" />
  </g>
)

const Hopper: PartComponent = () => (
  <g>
    <path d="M2,2 H58 L40,52 H20 Z" fill="#eef0f4" stroke="#333" strokeWidth="1.5" />
    {/* level grows UPWARD from the hopper base (y-flip like tank) */}
    <rect data-anchor="primary" x="20" y="0" width="20" height="0" fill="#d2a36b" transform="translate(0,52) scale(1,-1)" />
  </g>
)

// Slider: an analog INPUT control. Track + draggable thumb (data-anchor=primary,
// driven by a translateX effect so the thumb reflects the live PLC value) + a value
// readout (data-anchor=val, a text binding). SimRuntime attaches pointer-drag that
// force-writes the bound numeric var (%IW/%QW). Travel: thumb dx 0..126 over track.
const Slider: PartComponent = () => (
  <g>
    <rect x="0" y="2" width="150" height="40" rx="6" fill="#f4f5f7" stroke="#d6d9e0" />
    <rect x="12" y="26" width="126" height="6" rx="3" fill="#cfd4dd" />
    <rect data-anchor="primary" x="5" y="18" width="14" height="22" rx="3" fill="#2563eb" stroke="#1e3a8a" strokeWidth="1" />
    <text data-anchor="val" x="75" y="15" fontSize="12" fontFamily="monospace" fill="#384150" textAnchor="middle">0</text>
  </g>
)

const StackLight: PartComponent = () => (
  <g>
    <rect data-anchor="red" x="4" y="4" width="24" height="24" rx="3" fill="#5a1a1a" stroke="#222" />
    <rect data-anchor="amber" x="4" y="30" width="24" height="24" rx="3" fill="#5a4a1a" stroke="#222" />
    <rect data-anchor="green" x="4" y="56" width="24" height="24" rx="3" fill="#1a5a2a" stroke="#222" />
  </g>
)

export const PART_REGISTRY: Record<string, PartComponent> = {
  lamp: Lamp,
  'sensor-button': SensorButton,
  valve: Valve,
  cylinder: Cylinder,
  motor: Motor,
  conveyor: Conveyor,
  tank: Tank,
  'numeric-display': NumericDisplay,
  gauge: Gauge,
  pump: Pump,
  hopper: Hopper,
  'stack-light': StackLight,
  slider: Slider,
}

// Geometry constants, co-located with the SVG above so they cannot drift. `axis`
// (local coords) is the line a translateAlong workpiece travels; only conveyor
// needs it in P1. w/h are the part's local bounding box, derived from the SVG
// markup. parts-geom.test.ts pins the conveyor + sensor-button numbers to the SVG.
export interface PartGeom {
  w: number
  h: number
  axis?: { from: { x: number; y: number }; to: { x: number; y: number } }
}

export const PART_GEOM: Record<string, PartGeom> = {
  lamp:              { w: 44, h: 44 },         // circle cx22 cy22 r18 → bbox ~44
  'sensor-button':   { w: 48, h: 38 },         // bg rect x2 y6 w44 h32 → 48×38
  valve:             { w: 48, h: 48 },         // rect x6 y6 w36 h36 → 48
  cylinder:          { w: 52, h: 48 },         // body x0 y14 w34 + rod to x52
  motor:             { w: 44, h: 44 },         // circle cx22 cy22 r20 → ~44
  conveyor:          { w: 120, h: 54, axis: { from: { x: 0, y: 27 }, to: { x: 120, y: 27 } } },
                                               // frame rect x0 y20 w120 h14; centerline y=20+14/2=27
  tank:              { w: 52, h: 64 },         // rect x6 y2 w40 h60 → ~52×64
  'numeric-display': { w: 92, h: 34 },        // rect x0 y0 w92 h34
  gauge:             { w: 64, h: 64 },         // outer circle cx32 cy32 r30 → 64×64
  pump:              { w: 52, h: 52 },         // outer circle cx26 cy26 r24 → 52×52
  hopper:            { w: 60, h: 54 },         // path M2,2 H58 L40,52 H20 Z → x[2,58] y[2,52] → 60×54
  'stack-light':     { w: 32, h: 80 },        // 3 rects at y=4/30/56 each h=24 → y-max=80, x-max=28 → 32×80
  slider:            { w: 150, h: 44 },        // track bg rect x0 y2 w150 h40 → 150×44; thumb travel dx 0..126
}
