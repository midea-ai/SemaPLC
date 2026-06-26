import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, subscribeEditorToWs } from '../../src/store/editor'

const reset = () => useEditorStore.getState().clear()

describe('editor store 草稿模型', () => {
  beforeEach(reset)

  it('openFile 干净加载:stCode=diskContent,不脏,无徽标', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    const s = useEditorStore.getState()
    expect(s.stCode).toBe('A')
    expect(s.diskContent).toBe('A')
    expect(s.isDirty).toBe(false)
    expect(s.diskChanged).toBe(false)
    expect(s.stProgram).toBe('A')
    expect(s.stProgramPath).toBe('a.st')
  })

  it('setStCode 以 diskContent 为判脏基准,改回原值自动消脏', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('A2')
    expect(useEditorStore.getState().isDirty).toBe(true)
    useEditorStore.getState().setStCode('A')
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('onDiskUpdate 同路径脏:只更 diskContent + 徽标,不动草稿', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('draft')
    useEditorStore.getState().onDiskUpdate('B')
    const s = useEditorStore.getState()
    expect(s.stCode).toBe('draft')
    expect(s.diskContent).toBe('B')
    expect(s.diskChanged).toBe(true)
  })

  it('onDiskUpdate:每秒重推未变磁盘不误报 diskChanged;真变更则 sticky', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('draft')          // 脏(草稿 != 磁盘)
    useEditorStore.getState().onDiskUpdate('A')           // 轮询重推未变的磁盘内容
    expect(useEditorStore.getState().diskChanged).toBe(false)  // 磁盘没变 → 不该亮徽标
    useEditorStore.getState().onDiskUpdate('A-external')  // agent 真改了磁盘
    expect(useEditorStore.getState().diskChanged).toBe(true)
    useEditorStore.getState().onDiskUpdate('A-external')  // 再次重推同(已变)内容
    expect(useEditorStore.getState().diskChanged).toBe(true)   // sticky,保持到 refresh/save
  })

  it('refresh 本地应用 diskContent,丢弃草稿', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('draft')
    useEditorStore.getState().onDiskUpdate('B')
    useEditorStore.getState().refresh()
    const s = useEditorStore.getState()
    expect(s.stCode).toBe('B')
    expect(s.isDirty).toBe(false)
    expect(s.diskChanged).toBe(false)
  })

  it('saveAck 用回传 content 作基准;往返期间继续输入仍判脏', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('V1')
    useEditorStore.getState().setStCode('V2')
    useEditorStore.getState().saveAck('a.st', 'V1')
    const s = useEditorStore.getState()
    expect(s.diskContent).toBe('V1')
    expect(s.stProgram).toBe('V1')
    expect(s.isDirty).toBe(true)
    expect(s.diskChanged).toBe(false)
  })

  it('subscribeEditorToWs:editor:open 三路分流', () => {
    let cb: ((m: any) => void) | undefined
    const fakeClient = { on: (fn: (m: any) => void) => { cb = fn; return () => {} } } as any
    subscribeEditorToWs(fakeClient)
    const s = () => useEditorStore.getState()

    // 1) 切文件 → openFile(干净加载)
    cb!({ type: 'editor:open', path: 'a.st', content: 'A' })
    expect(s().currentPath).toBe('a.st')
    expect(s().stCode).toBe('A')
    expect(s().isDirty).toBe(false)

    // 2) 同路径、不脏、内容未变 → no-op
    cb!({ type: 'editor:open', path: 'a.st', content: 'A' })
    expect(s().stCode).toBe('A')
    expect(s().isDirty).toBe(false)

    // 3) 同路径、不脏、磁盘已变 → 应用最新
    cb!({ type: 'editor:open', path: 'a.st', content: 'A-disk' })
    expect(s().stCode).toBe('A-disk')

    // 4) 同路径、脏 → onDiskUpdate(草稿不动 + diskChanged)
    s().setStCode('draft')
    cb!({ type: 'editor:open', path: 'a.st', content: 'A-disk2' })
    expect(s().stCode).toBe('draft')
    expect(s().diskContent).toBe('A-disk2')
    expect(s().diskChanged).toBe(true)
  })

  it('saveAck:迟到回执(非当前文件)不污染当前文件', () => {
    useEditorStore.getState().openFile('a.st', 'A')
    useEditorStore.getState().setStCode('A-edit')      // a 变脏
    useEditorStore.getState().openFile('b.st', 'B')    // 切到 b(干净)
    useEditorStore.getState().saveAck('a.st', 'A-edit') // a 的回执迟到
    const s = useEditorStore.getState()
    expect(s.currentPath).toBe('b.st')
    expect(s.stProgram).toBe('B')        // Run 目标仍是 b,未被 a 改回
    expect(s.stProgramPath).toBe('b.st')
    expect(s.isDirty).toBe(false)        // b 未被 a 的回执弄脏
    expect(s.diskContent).toBe('B')
  })
})
