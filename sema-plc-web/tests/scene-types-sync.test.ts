import { describe, it, expect } from 'vitest'
import type { SceneSpec as ToolsScene } from '../../sema-plc-tools/src/tools/sceneSpec'
import type { SceneSpec as WebScene } from '../shared/protocol'

// A single literal must satisfy BOTH SceneSpec definitions. If the two type
// files drift (one adds a v2 field the other lacks), this file fails to compile.
const scene = {
  version: '2' as const,
  canvas: { width: 200, height: 100 },
  parts: [
    { id: 'belt', kind: 'conveyor', x: 0, y: 40, bindings: [
      { variable: 'pos', effect: {
        type: 'translateAlong' as const, host: 'belt', axis: 'x' as const,
        variable: 'pos', valueFrom: 0, valueTo: 100,
      } },
    ] },
    { id: 'sensor', kind: 'sensor-button', x: 0, y: 0,
      snap: { to: 'belt', dx: 30, dy: -6 }, bindings: [] },
  ],
}

const asTools: ToolsScene = scene
const asWeb: WebScene = scene

describe('SceneSpec type parity (plc-tools vs protocol)', () => {
  it('one v2 literal satisfies both definitions', () => {
    expect(asTools.version).toBe('2')
    expect(asWeb.version).toBe('2')
    expect(asTools.parts[1].snap).toEqual(asWeb.parts[1].snap)
  })
})
