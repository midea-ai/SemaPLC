import { describe, it, expect } from 'vitest'
import { parseRecordHeader, parseRecordFrames, buildRecordCommand } from '../src/client/record.js'

// Synthetic INFO payload (post-envelope, i.e. after stripping the `46 7e`
// runtime prefix). Layout is the FROZEN recorder.c contract (all BE):
//   u8 kind=0x01 | u32 magic "REC1" | u16 ver | u16 var_count | u16 skipped
//   | u16 decimation | u32 slot_size | u32 frames | u32 count | char md5[32]
//   | var_count × { u16 idx | u32 off | u16 size }
function syntheticHeader(): number[] {
  return [0x01, 0x52,0x45,0x43,0x31, 0,1, 0,2, 0,0, 0,1, 0,0,0,3, 0,0,0x0f,0xa0, 0,0,0,10,
    ...Array(32).fill(0x61), 0,0, 0,0,0,0, 0,1,  0,1, 0,0,0,1, 0,2]
}

describe('record wire parsing', () => {
  it('builds the 0x46 command (u64 BE fromTick + u16 BE maxSlots)', () => {
    expect(buildRecordCommand(0x1122n, 64)).toBe('46 00 00 00 00 00 00 11 22 00 40')
  })

  it('parses header: magic/ver/md5/slot/decimation/vartable', () => {
    const h = parseRecordHeader(syntheticHeader())
    expect(h.md5).toBe('a'.repeat(32))
    expect(h.slotSize).toBe(3)
    expect(h.decimation).toBe(1)
    expect(h.count).toBe(10)
    expect(h.vars).toEqual([{ idx: 0, off: 0, size: 1 }, { idx: 1, off: 1, size: 2 }])
  })

  it('rejects bad magic', () => {
    const bad = syntheticHeader(); bad[1] = 0x00
    expect(() => parseRecordHeader(bad)).toThrow(/magic/)
  })

  it('parses a frame page and surfaces nextFromTick for pagination', () => {
    // kind=0x02 | n=1 | next_from=0x99 | { tick=5 | slot [1, 0x34, 0x12] }
    const page = [0x02, 0,1, 0,0,0,0,0,0,0,0x99, 0,0,0,0,0,0,0,5, 1, 0x34,0x12]
    const { frames, nextFromTick } = parseRecordFrames(page, 3)
    expect(frames).toEqual([{ tick: 5n, slot: [1, 0x34, 0x12] }])
    expect(nextFromTick).toBe(0x99n)
  })
})
