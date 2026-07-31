import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dataDir } from '../../server/data-dir.js'

describe('SEMAPLC_DATA_DIR', () => {
  afterEach(() => { delete process.env.SEMAPLC_DATA_DIR })

  it('不设该 env 时回退 process.cwd()(向后兼容)', () => {
    expect(dataDir()).toBe(process.cwd())
  })

  it('设了就用它,且目录不存在时递归创建', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-data-')), 'a', 'b')
    process.env.SEMAPLC_DATA_DIR = dir
    expect(dataDir()).toBe(dir)
    expect(fs.existsSync(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
