import { create } from 'zustand'
import type { WsClientLike } from '../ws/client'

interface EditorStore {
  files: Array<{ path: string; mtime: number }>
  currentPath: string | null
  stCode: string
  diskContent: string
  // 「要运行的 .st 程序」与「当前显示的文件」解耦:打开 plan.json/scene.json 等非 .st
  // 文件时只改 currentPath/stCode(显示),stProgram 保留最近一次打开/保存的 .st,这样 Run
  // 按钮永远针对真实 .st 程序,不会被切到配置文件就锁死。空路径('')视为关闭,一并清空。
  stProgram: string
  stProgramPath: string | null
  normalized: string
  normalizeError: string | null
  isDirty: boolean
  diskChanged: boolean
  setFiles: (files: Array<{ path: string; mtime: number }>) => void
  openFile: (path: string, content: string) => void
  onDiskUpdate: (content: string) => void
  saveAck: (path: string, content: string) => void
  setStCode: (code: string) => void
  refresh: () => void
  setNormalized: (normalized: string, error: string | null) => void
  clear: () => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  files: [],
  currentPath: null,
  stCode: '',
  diskContent: '',
  stProgram: '',
  stProgramPath: null,
  normalized: '',
  normalizeError: null,
  isDirty: false,
  diskChanged: false,
  setFiles: (files) => set({ files }),
  openFile: (currentPath, content) =>
    set(
      currentPath.toLowerCase().endsWith('.st')
        ? { currentPath, stCode: content, diskContent: content, isDirty: false, diskChanged: false, stProgram: content, stProgramPath: currentPath }
        : { currentPath, stCode: content, diskContent: content, isDirty: false, diskChanged: false, ...(currentPath === '' ? { stProgram: '', stProgramPath: null } : {}) },
    ),
  // diskChanged 反映「磁盘相对上次已知磁盘内容是否变了」(外部/agent 改了文件),
  // 而非「磁盘 vs 当前草稿」——后者在编辑期间恒为真,会被每秒重推的未变磁盘误触发。
  // 一旦判定变更即 sticky,直到 refresh/save 复位。
  onDiskUpdate: (content) => set((s) => ({ diskContent: content, diskChanged: content !== s.diskContent ? true : s.diskChanged })),
  saveAck: (path, content) =>
    set((s) => {
      // 迟到回执:用户已切到别的文件,不污染当前文件草稿状态 / Run 目标
      if (path !== s.currentPath) return {}
      return path.toLowerCase().endsWith('.st')
        ? { diskContent: content, isDirty: s.stCode !== content, diskChanged: false, stProgram: content, stProgramPath: path }
        : { diskContent: content, isDirty: s.stCode !== content, diskChanged: false }
    }),
  setStCode: (code) =>
    set((s) => ({ stCode: code, isDirty: code !== s.diskContent, diskChanged: code === s.diskContent ? false : s.diskChanged })),
  refresh: () => set((s) => ({ stCode: s.diskContent, isDirty: false, diskChanged: false })),
  setNormalized: (normalized, error) => set({ normalized, normalizeError: error }),
  clear: () => set({ files: [], currentPath: null, stCode: '', diskContent: '', stProgram: '', stProgramPath: null, normalized: '', normalizeError: null, isDirty: false, diskChanged: false }),
}))

export function subscribeEditorToWs(client: WsClientLike) {
  client.on((m) => {
    const store = useEditorStore.getState()
    switch (m.type) {
      case 'editor:files':
        store.setFiles(m.files)
        break
      case 'editor:open': {
        // §6 三路分流:切文件 / 同路径脏不覆盖 / 不脏未变 no-op
        if (m.path !== store.currentPath) { store.openFile(m.path, m.content); break }
        if (store.isDirty) { store.onDiskUpdate(m.content); break }
        if (m.content === store.stCode) break          // 每秒重推且未变 → no-op,避免重置编辑器
        store.openFile(m.path, m.content)               // 干净编辑器下磁盘变了 → 应用最新
        break
      }
      case 'editor:saved':
        store.saveAck(m.path, m.content ?? useEditorStore.getState().stCode)
        break
      case 'workspace:switching':
        store.clear()
        break
    }
  })
}
