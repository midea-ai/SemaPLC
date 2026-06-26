import { describe, it, expect, beforeEach } from 'vitest'
import { useSimStore } from '../src/store/sim'
import type { SceneSpec } from '../shared/protocol'

const SCENE: SceneSpec = { version: '1', canvas: { width: 100, height: 100 }, parts: [] }

describe('sim store', () => {
  beforeEach(() => useSimStore.getState().clear())
  it('starts empty', () => {
    expect(useSimStore.getState().scene).toBeNull()
  })
  it('setScene stores the scene', () => {
    useSimStore.getState().setScene(SCENE)
    expect(useSimStore.getState().scene).toEqual(SCENE)
  })
  it('clear resets to null', () => {
    useSimStore.getState().setScene(SCENE)
    useSimStore.getState().clear()
    expect(useSimStore.getState().scene).toBeNull()
  })
})
