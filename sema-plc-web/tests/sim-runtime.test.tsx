import { render, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }))
vi.mock('../src/ws/useWsConnection', () => ({
  useWsConnection: () => ({ send: sendSpy, status: 'open' }),
}))
import { SimRuntime } from '../src/components/sim/SimRuntime'
import { useSimStore } from '../src/store/sim'
import { usePlcStore } from '../src/store/plc'
import type { SceneSpec } from '../shared/protocol'

afterEach(cleanup)

beforeEach(() => {
  useSimStore.getState().clear()
  usePlcStore.getState().clear()
  sendSpy.mockClear()
})

function setValue(name: string, value: number | boolean) {
  usePlcStore.getState().setValues({ [name]: { value, type: typeof value === 'boolean' ? 'BOOL' : 'INT', index: 0, location: '' } })
}

const LAMP_SCENE: SceneSpec = {
  version: '1', canvas: { width: 100, height: 100 },
  parts: [{ id: 'p1', kind: 'lamp', x: 0, y: 0, label: 'red', bindings: [
    { variable: 'red', effect: { type: 'fill', map: [{ when: { eq: false }, color: '#999999' }, { when: { eq: true }, color: '#22c55e' }] } },
  ] }],
}

describe('SimRuntime', () => {
  it('shows an empty hint when there is no scene', () => {
    useSimStore.getState().clear()
    const { container } = render(<SimRuntime />)
    expect(container.textContent).toMatch(/过程仿真/)
  })
  it('colors a lamp green when its variable is true', () => {
    useSimStore.getState().setScene(LAMP_SCENE)
    setValue('red', true)
    const { container } = render(<SimRuntime />)
    const anchor = container.querySelector('[data-part-id="p1"] [data-anchor="primary"]')!
    expect(anchor.getAttribute('fill')).toBe('#22c55e')
  })
  it('recolors when the value changes to false', () => {
    useSimStore.getState().setScene(LAMP_SCENE)
    setValue('red', true)
    const { container, rerender } = render(<SimRuntime />)
    setValue('red', false)
    rerender(<SimRuntime />)
    const anchor = container.querySelector('[data-part-id="p1"] [data-anchor="primary"]')!
    expect(anchor.getAttribute('fill')).toBe('#999999')
  })
  it('drives a slider thumb (translateX) + value text from the live value (read-back)', () => {
    const sliderScene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 80 },
      parts: [{ id: 's1', kind: 'slider', x: 0, y: 0, label: 'sp', params: { min: 0, max: 100, step: 1 }, bindings: [
        { variable: 'sp', effect: { type: 'translateX', valueFrom: 0, valueTo: 100, from: 0, to: 126 } },
        { variable: 'sp', target: 'val', effect: { type: 'text', format: '{v}' } },
      ] }],
    }
    useSimStore.getState().setScene(sliderScene)
    setValue('sp', 50)
    const { container } = render(<SimRuntime />)
    const thumb = container.querySelector('[data-part-id="s1"] [data-anchor="primary"]')!
    expect(thumb.getAttribute('transform')).toBe('translate(63,0)')   // 50/100 * 126
    expect(container.querySelector('[data-part-id="s1"] [data-anchor="val"]')!.textContent).toBe('50')
    cleanup()
  })
  it('slider drag forces ONCE on pointer-up, never during pointermove (no force flood)', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 200, height: 80 },
      parts: [{ id: 's1', kind: 'slider', x: 0, y: 0, label: 'cap', params: { min: 0, max: 100, step: 1 }, bindings: [
        { variable: 'capacity', effect: { type: 'translateX', valueFrom: 0, valueTo: 100, from: 0, to: 126 } },
      ] }],
    })
    // forceable analog input: located %IW, non-BOOL → draggable
    usePlcStore.setState({ status: 'RUNNING', variableMap: [{ index: 0, name: 'capacity', type: 'INT', location: '%IW0' }] })
    const { container } = render(<SimRuntime />)
    const svg = container.querySelector('svg')!
    ;(svg as unknown as { getScreenCTM: () => null }).getScreenCTM = () => null  // jsdom: valueAt → min, no throw
    const group = container.querySelector('[data-part-id="s1"]')!
    const forces = () => sendSpy.mock.calls.filter((c) => (c[0] as { type?: string })?.type === 'plc:force')

    fireEvent.pointerDown(group, { clientX: 10, clientY: 5 })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 5 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 5 }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 5 }))
    expect(forces().length).toBe(0)   // 拖动过程中绝不 force

    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 90, clientY: 5 }))
    expect(forces().length).toBe(1)   // 仅松手提交一次
    expect((forces()[0][0] as { type: string; set: Record<string, unknown> }).set).toHaveProperty('capacity')
    cleanup()
  })
  it('renders a custom part svg and drives a targeted element', () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'c1', kind: 'custom', x: 0, y: 0, svg: '<rect id="door" width="10" height="10" fill="#000"/>',
        bindings: [{ variable: 'open', target: 'door', effect: { type: 'fill', map: [{ when: { truthy: true }, color: '#0f0' }] } }] }],
    }
    useSimStore.getState().setScene(scene)
    setValue('open', true)
    const { container } = render(<SimRuntime />)
    expect(container.querySelector('[data-part-id="c1"] #door')!.getAttribute('fill')).toBe('#0f0')
  })

  it('clicking an input-bound (%IX BOOL) part TOGGLES it: off→force true, on→release', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 's', kind: 'sensor-button', x: 0, y: 0, bindings: [
        { variable: 'sensor', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } },
      ] }],
    })
    usePlcStore.setState({ status: 'RUNNING', variableMap: [{ index: 0, name: 'sensor', type: 'BOOL', location: '%IX0.0' }] })
    const { container } = render(<SimRuntime />)
    // value currently false/undefined → click forces it true (held, no auto-release)
    fireEvent.click(container.querySelector('[data-part-id="s"]')!)
    expect(sendSpy).toHaveBeenCalledWith({ type: 'plc:force', set: { sensor: true } })
    // now value is true → next click releases it back to 0 (NOT another set)
    sendSpy.mockClear()
    usePlcStore.setState({ values: { sensor: { value: true, type: 'BOOL', index: 0, location: '%IX0.0' } } })
    fireEvent.click(container.querySelector('[data-part-id="s"]')!)
    expect(sendSpy).toHaveBeenCalledWith({ type: 'plc:force', release: ['sensor'] })
  })

  it('resolves a mixed-case binding variable against the lowercased runtime map (matiec lowercases)', () => {
    // matiec lowercases names; the agent authors the scene with ST source casing.
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'p', kind: 'sensor-button', x: 0, y: 0, bindings: [
        { variable: 'Sensor_Color_A', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } },
      ] }],
    })
    usePlcStore.setState({ status: 'RUNNING', variableMap: [{ index: 0, name: 'sensor_color_a', type: 'BOOL', location: '%IX0.2' }] })
    const { container } = render(<SimRuntime />)
    // mixed-case binding must still be clickable (resolves to sensor_color_a) and force it
    fireEvent.click(container.querySelector('[data-part-id="p"]')!)
    expect(sendSpy).toHaveBeenCalledWith({ type: 'plc:force', set: { Sensor_Color_A: true } })
  })

  it('custom whole-scene image: each input sub-element triggers only its own var; blank does not', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
        svg: '<rect id="s_el" x="0" width="10" height="10"/><rect id="r_el" x="20" width="10" height="10"/><rect id="blank" x="40" width="10" height="10"/>',
        bindings: [
          { variable: 'sensor', target: 's_el', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } },
          { variable: 'reset', target: 'r_el', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } },
        ] }],
    })
    usePlcStore.setState({ status: 'RUNNING', variableMap: [
      { index: 0, name: 'sensor', type: 'BOOL', location: '%IX0.0' },
      { index: 1, name: 'reset', type: 'BOOL', location: '%IX0.1' },
    ] })
    const { container } = render(<SimRuntime />)
    fireEvent.click(container.querySelector('#s_el')!)
    expect(sendSpy).toHaveBeenCalledWith({ type: 'plc:force', set: { sensor: true } })
    sendSpy.mockClear()
    fireEvent.click(container.querySelector('#r_el')!)
    expect(sendSpy).toHaveBeenCalledWith({ type: 'plc:force', set: { reset: true } })
    sendSpy.mockClear()
    // blank sub-element has no input binding → clicking it forces nothing
    fireEvent.click(container.querySelector('#blank')!)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('does not make an output-bound (%QX) part clickable', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'c', kind: 'cylinder', x: 0, y: 0, bindings: [
        { variable: 'cyl', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } },
      ] }],
    })
    usePlcStore.setState({ status: 'RUNNING', variableMap: [{ index: 0, name: 'cyl', type: 'BOOL', location: '%QX0.0' }] })
    const { container } = render(<SimRuntime />)
    fireEvent.click(container.querySelector('[data-part-id="c"]')!)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('places a numeric-display label closer (box.h=34 → y=48, not hardcoded 78)', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 200, height: 200 },
      parts: [{ id: 'n', kind: 'numeric-display', x: 0, y: 0, label: 'cnt', bindings: [
        { variable: 'cnt', effect: { type: 'text' } }] }],
    } as any)
    setValue('cnt', 0)
    const { container } = render(<SimRuntime />)
    const label = container.querySelector('[data-part-id="n"] text.sim-label')!
    expect(Number(label.getAttribute('y'))).toBe(48)
  })
  it('places a conveyor label at y=68 (box.h=54 → 54+14)', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 300, height: 200 },
      parts: [{ id: 'cv', kind: 'conveyor', x: 0, y: 0, label: 'belt', bindings: [
        { variable: 'belt', effect: { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] } }] }],
    } as any)
    setValue('belt', true)
    const { container } = render(<SimRuntime />)
    const label = container.querySelector('[data-part-id="cv"] text.sim-label')!
    expect(Number(label.getAttribute('y'))).toBe(68)
  })
  it('marks tweenable custom binding targets with data-sim-tween (not text/visible)', () => {
    // 场景:custom 内 car 绑 translateY(可补间)、label1 绑 text(不可补间)
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 520 },
      parts: [{ id: 'shaft', kind: 'custom', x: 0, y: 0,
        svg: `<svg viewBox='0 0 200 520'><rect id='car' y='380' width='10' height='10'/><text id='label1' y='20'>0</text></svg>`,
        bindings: [
          { variable: 'car_pos', target: 'car', effect: { type: 'translateY', valueFrom: 0, valueTo: 300, from: 0, to: -280 } },
          { variable: 'car_pos', target: 'label1', effect: { type: 'text' } },
        ] }],
    }
    useSimStore.getState().setScene(scene)
    render(<SimRuntime />)
    expect(document.querySelector('[id="car"]')?.hasAttribute('data-sim-tween')).toBe(true)
    expect(document.querySelector('[id="label1"]')?.hasAttribute('data-sim-tween')).toBe(false)
  })
})

describe('SimRuntime custom svg 尺寸归一(防膨胀溢出)', () => {
  it('viewBox-only 的 custom svg 渲染时补上 width/height = viewBox 宽高', () => {
    useSimStore.getState().setScene({
      version: '1', canvas: { width: 400, height: 300 },
      parts: [{ id: 'c', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 120 90"><rect id="r" width="10" height="10"/></svg>',
        bindings: [] }],
    } as any)
    const { container } = render(<SimRuntime />)
    const inner = container.querySelector('[data-part-id="c"] svg')!
    expect(inner.getAttribute('width')).toBe('120')
    expect(inner.getAttribute('height')).toBe('90')
  })
})

describe('SimRuntime 坏 scene 防御(防白屏)', () => {
  it('parts 非数组 → 不抛,渲染空舞台(0 个部件)', () => {
    // write_file 直写可能把 parts 写成对象 {"0":...} 而非数组
    useSimStore.getState().setScene({ version: '1', canvas: { width: 100, height: 100 }, parts: { '0': {} } } as any)
    const { container } = render(<SimRuntime />)
    expect(container.textContent).toMatch(/0 个部件/)
    expect(container.querySelector('svg')).toBeTruthy()
  })
  it('canvas 缺失 → 不抛,用默认尺寸渲染', () => {
    useSimStore.getState().setScene({ version: '1', parts: [] } as any)
    const { container } = render(<SimRuntime />)
    expect(container.querySelector('svg')!.style.width).toBe('100%')
  })
})

describe('SimRuntime v2 layout + translateAlong', () => {
  it('places a snapped part at the resolved absolute transform', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 300, height: 200 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 100, y: 50, bindings: [] },
        { id: 'box', kind: 'lamp', x: 0, y: 0, snap: { to: 'belt', dx: 20, dy: -6 }, bindings: [] },
      ],
    }
    useSimStore.getState().setScene(scene)
    const { container } = render(<SimRuntime />)
    const g = container.querySelector('[data-part-id="box"]')!
    expect(g.getAttribute('transform')).toBe('translate(120,44)')
  })

  it('flows a translateAlong workpiece down the belt with the variable value', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 300, height: 200 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 100, y: 50, bindings: [] },
        { id: 'wppart', kind: 'custom', x: 0, y: 0,
          svg: '<rect id="wp" width="8" height="8"/>',
          bindings: [
            { variable: 'pos', target: 'wp', effect: {
              type: 'translateAlong', host: 'belt', axis: 'x',
              variable: 'pos', valueFrom: 0, valueTo: 100,
            } },
          ] },
      ],
    }
    useSimStore.getState().setScene(scene)

    const { container, rerender } = render(<SimRuntime />)
    setValue('pos', 0)
    rerender(<SimRuntime />)
    const wp = container.querySelector('[data-part-id="wppart"] #wp')!
    expect(wp.getAttribute('transform')).toBe('translate(100,77)')

    setValue('pos', 50)
    rerender(<SimRuntime />)
    expect(wp.getAttribute('transform')).toBe('translate(160,77)')

    setValue('pos', 999)
    rerender(<SimRuntime />)
    expect(wp.getAttribute('transform')).toBe('translate(220,77)')
  })
})

// custom 部件 = 一整幅自绘画面,标题画在 svg 里。之前外层还会再画一次 part.label,
// 且 y 取自 PARTS_CATALOG(里面没有 custom → 回退 64)→ 标注落在 y=78,正好压住画面内
// y≈75 的标题(实测:分拣场景左上角两行字叠在一起)。
describe('custom 部件的标注', () => {
  const customScene = (): SceneSpec => ({
    version: '1', canvas: { width: 400, height: 300 },
    parts: [{ id: 'pic', kind: 'custom', x: 0, y: 0, label: '分拣线',
      svg: '<svg viewBox="0 0 400 300"><text x="10" y="75">传送带颜色 / 高度分拣</text></svg>', bindings: [] }],
  })

  it('不画外层标注(不会压住画面自己的标题)', () => {
    useSimStore.getState().setScene(customScene())
    const { container } = render(<SimRuntime />)
    expect([...container.querySelectorAll('text.sim-label')].some((n) => n.textContent === '分拣线')).toBe(false)
    expect(container.textContent).toContain('传送带颜色 / 高度分拣')
  })

  it('库部件的标注照常渲染', () => {
    useSimStore.getState().setScene(LAMP_SCENE)
    const { container } = render(<SimRuntime />)
    expect([...container.querySelectorAll('text.sim-label')].some((n) => n.textContent === 'red')).toBe(true)
  })
})
