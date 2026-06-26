import { useMemo } from 'react'
import { transformSTToLadderIR } from '../../transformer/st-to-ladder'
import { LadderRungView } from './LadderRungView'
import { usePlcStore } from '../../store/plc'
import { useEditorStore } from '../../store/editor'
import { useT } from '../../i18n'
import './ladder-rungs.css'

/**
 * Ladder (梯形图) viewer rendered as SemaPLC named rung cards (number badge +
 * comment) with an inline SVG of contacts / coils / TON-CTU blocks and left/
 * right power rails. Energized elements light green when the PLC is RUNNING.
 *
 * This replaces the previous React Flow node-graph rendering. It parses ST →
 * ladder IR (transformSTToLadderIR) and draws directly from the rung/
 * inputNetwork/output structure; live coloring comes from the plc store values.
 */

/**
 * OpenPLC runtime expects ST that ends with a CONFIGURATION ... END_CONFIGURATION
 * block declaring the resource + task, but the lifted ladder transformer was
 * written for "pure" ST (just PROGRAM ... END_PROGRAM) and reports syntax errors
 * for the trailing block. Strip it for visualisation only; the compile path
 * (plc-tools) sees the original source.
 */
function stripConfigurationBlock(src: string): string {
  const m = src.match(/^([\s\S]*?END_PROGRAM)/i)
  return m ? m[1] : src
}

export function LadderCanvas({ stCode }: { stCode: string }) {
  const t = useT()
  const parsed = useMemo(() => {
    if (!stCode.trim()) {
      return { ir: undefined, errors: [{ message: 'No ST source.' }] }
    }
    const visualSrc = stripConfigurationBlock(stCode)
    try {
      const r = transformSTToLadderIR(visualSrc)
      return { ir: r.success ? r.ir : undefined, errors: r.errors }
    } catch (e) {
      return { ir: undefined, errors: [{ message: String(e) }] }
    }
  }, [stCode])

  // Live runtime values for energization. Only color while the PLC is scanning.
  const values = usePlcStore((s) => s.values)
  const status = usePlcStore((s) => s.status)
  const running = status === 'RUNNING'

  // Non-ST files (io_map.yaml / plc.yaml / fuxa_project.json …) have no ladder —
  // show a clean hint instead of dumping ST parse errors for non-ST content.
  const currentPath = useEditorStore((s) => s.currentPath)
  if (currentPath && !currentPath.toLowerCase().endsWith('.st')) {
    const fname = currentPath.split('/').pop()
    return (
      <div className="h-full flex flex-col">
        <div className="ld-nonst">
          <div className="ld-nonst-title">{t('ladder.nonst.title')}</div>
          <div className="ld-nonst-sub">{t('ladder.nonst.sub', { file: fname ?? currentPath })}</div>
        </div>
      </div>
    )
  }

  if (!parsed.ir || parsed.ir.rungs.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="ld-fallback">
          <div className="ld-fallback-note">
            {t('ladder.fallback.note')}
          </div>
          {parsed.errors.length > 0 && (
            <ul className="ld-fallback-errs">
              {parsed.errors.slice(0, 5).map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          )}
          <pre>{stCode}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <LadderRungView ir={parsed.ir} values={values} running={running} />
    </div>
  )
}
