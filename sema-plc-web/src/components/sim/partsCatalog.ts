// Machine-readable parts vocabulary — the VISUAL SOURCE OF TRUTH. plc-tools keeps
// a lightweight copy (PART_KINDS/PART_BOXES/PARTS_CATALOG_MD) guarded by a snapshot
// test (plc-tools tests/tools/catalogSync.test.ts).
export interface PartDoc {
  kind: string
  description: string
  primaryAnchor: string                       // what data-anchor="primary" represents
  extraAnchors?: string[]                      // named anchors beyond primary (stack-light)
  suitsValueType: 'BOOL' | 'INT/REAL' | 'any'
  effects: string[]
  box: { w: number; h: number }               // local coordinate box: layout / overflow / scale ref
  requiresManualLayout?: boolean              // multi-binding parts suggestScene must not auto-place
  notes?: string                              // drawing constraint (e.g. gauge needle pivot)
}

export const PARTS_CATALOG: PartDoc[] = [
  { kind: 'lamp', description: '指示灯,按值变色(灭/亮)', primaryAnchor: '灯体圆', suitsValueType: 'BOOL', effects: ['fill', 'visible'], box: { w: 44, h: 44 } },
  { kind: 'sensor-button', description: '传感器/按钮状态指示', primaryAnchor: '状态圆', suitsValueType: 'BOOL', effects: ['fill'], box: { w: 48, h: 38 } },
  { kind: 'valve', description: '阀,开/关按值变色', primaryAnchor: '阀体方块', suitsValueType: 'BOOL', effects: ['fill', 'class'], box: { w: 48, h: 48 } },
  { kind: 'cylinder', description: '气缸活塞,伸出/缩回', primaryAnchor: '活塞杆', suitsValueType: 'BOOL', effects: ['fill', 'translateX', 'visible'], box: { w: 52, h: 48 } },
  { kind: 'motor', description: '马达,运行时旋转', primaryAnchor: '转子组(加 sim-run 类旋转)', suitsValueType: 'BOOL', effects: ['class', 'rotate', 'fill'], box: { w: 44, h: 44 } },
  { kind: 'conveyor', description: '传送带,运行时皮带滚动', primaryAnchor: '皮带刻线组(加 sim-run 类滚动)', suitsValueType: 'BOOL', effects: ['class'], box: { w: 120, h: 54 } },
  { kind: 'tank', description: '罐/液位,按值升降液面', primaryAnchor: '液面矩形(height 驱动)', suitsValueType: 'INT/REAL', effects: ['height', 'fill'], box: { w: 52, h: 64 } },
  { kind: 'numeric-display', description: '数码显示,显示数值', primaryAnchor: '文本', suitsValueType: 'INT/REAL', effects: ['text'], box: { w: 92, h: 34 } },
  // ── 新增 4 件 ──
  { kind: 'gauge', description: '指针表,指针随值旋转', primaryAnchor: '指针(needle)', suitsValueType: 'INT/REAL', effects: ['rotate'], box: { w: 64, h: 64 },
    notes: 'needle 以局部 (0,0) 为轴心绘制,外层 <g transform="translate(cx,cy)"> 包裹,这样 rotate(N) 绕圆心而非 SVG 原点' },
  { kind: 'pump', description: '泵,运行时叶轮旋转', primaryAnchor: '叶轮组(加 sim-run 类旋转)', suitsValueType: 'BOOL', effects: ['class', 'fill'], box: { w: 52, h: 52 } },
  { kind: 'hopper', description: '料斗,按值升降料位', primaryAnchor: '料位矩形(height 驱动)', suitsValueType: 'INT/REAL', effects: ['height', 'fill'], box: { w: 60, h: 54 } },
  { kind: 'stack-light', description: '报警灯柱,红/黄/绿三段各按一条 binding 变色', primaryAnchor: 'red 段', extraAnchors: ['red', 'amber', 'green'], suitsValueType: 'BOOL', effects: ['fill'], box: { w: 32, h: 80 }, requiresManualLayout: true,
    notes: '多 binding 件:三段各用具名 data-anchor(red/amber/green),每段 fill map 必须含 on+off 两条;suggestScene 不自动布局' },
  { kind: 'slider', description: '模拟量输入滑块,可拖动设定数值', primaryAnchor: '拇指(thumb,translateX 驱动反映实时值)', extraAnchors: ['val'], suitsValueType: 'INT/REAL', effects: ['translateX', 'text'], box: { w: 150, h: 44 },
    notes: '输入控件:绑可 force 的数值量(%IW/%QW);primary 绑 translateX(valueFrom/to=min/max,from=0/to=126)让拇指反映实时值,val 绑 text 显示数值;运行时拖动拇指经 plc:force 写值。params:{min,max,step}' },
]

export const PARTS_CATALOG_MD = PARTS_CATALOG.map(
  (p) =>
    `- \`${p.kind}\` — ${p.description}(主锚点:${p.primaryAnchor};值类型:${p.suitsValueType};效果:${p.effects.join('/')};box ${p.box.w}×${p.box.h}${p.notes ? `;${p.notes}` : ''})`,
).join('\n')
