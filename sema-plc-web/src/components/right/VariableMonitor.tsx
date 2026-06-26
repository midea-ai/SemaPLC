import { useRef, useState } from 'react'
import { usePlcStore } from '../../store/plc'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT } from '../../i18n'
import type { VariableEntry } from '../../../shared/protocol'
import './vars-view.css'

const NUMERIC_TYPES = new Set(['INT', 'DINT', 'UINT', 'SINT', 'LINT', 'WORD', 'DWORD', 'BYTE', 'REAL', 'LREAL', 'TIME'])

function isBool(type: string) {
  return type.toUpperCase() === 'BOOL'
}
function isNumeric(type: string) {
  return NUMERIC_TYPES.has(type.toUpperCase())
}

function ForceControls({ v }: { v: VariableEntry }) {
  const t = useT()
  const { send, status: wsStatus } = useWsConnection()
  const plcStatus = usePlcStore((s) => s.status)
  const forced = usePlcStore((s) => s.forced)
  const forcing = usePlcStore((s) => s.forcing)
  const markForcing = usePlcStore((s) => s.markForcing)
  const [numInput, setNumInput] = useState('')

  const isForced = forced.has(v.name)
  const isBusy = forcing.has(v.name)
  // Forcing only makes sense when the runtime is live.
  const disabled = wsStatus !== 'open' || plcStatus !== 'RUNNING' || isBusy

  const sendForce = (value: number | boolean) => {
    markForcing(v.name)
    send({ type: 'plc:force', set: { [v.name]: value } })
  }
  const sendRelease = () => {
    markForcing(v.name)
    send({ type: 'plc:force', release: [v.name] })
  }

  if (isBool(v.type)) {
    return (
      <div className="fc">
        <button disabled={disabled} onClick={() => sendForce(true)} className="fc-btn t" title={t('vars.force.true')}>T</button>
        <button disabled={disabled} onClick={() => sendForce(false)} className="fc-btn" title={t('vars.force.false')}>F</button>
        {isForced && (
          <button disabled={disabled} onClick={sendRelease} className="fc-btn release" title={t('vars.force.release')}>✕</button>
        )}
      </div>
    )
  }

  if (isNumeric(v.type)) {
    const invalid = numInput.trim() === '' || Number.isNaN(Number(numInput))
    return (
      <div className="fc">
        <input
          value={numInput}
          onChange={(e) => setNumInput(e.target.value)}
          disabled={disabled}
          placeholder={t('vars.force.valPlaceholder')}
          className="fc-input"
          onKeyDown={(e) => { if (e.key === 'Enter' && !invalid) { sendForce(Number(numInput)); setNumInput('') } }}
        />
        <button
          disabled={disabled || invalid}
          onClick={() => { sendForce(Number(numInput)); setNumInput('') }}
          className="fc-btn set"
          title={t('vars.force.value')}
        >{t('vars.force.set')}</button>
        {isForced && (
          <button disabled={disabled} onClick={sendRelease} className="fc-btn release" title={t('vars.force.release')}>✕</button>
        )}
      </div>
    )
  }

  return <span className="fc-na">—</span>
}

function directionClass(location: string): 'in' | 'out' | '' {
  if (/^%I/i.test(location)) return 'in'
  if (/^%Q/i.test(location)) return 'out'
  return ''
}

export function VariableMonitor() {
  const t = useT()
  const variableMap = usePlcStore((s) => s.variableMap)
  const values = usePlcStore((s) => s.values)
  const status = usePlcStore((s) => s.status)
  const forced = usePlcStore((s) => s.forced)

  // Track previous values so a row can flash brand-soft when its value changes.
  const prev = useRef<Record<string, unknown>>({})
  const flashed: Record<string, boolean> = {}
  for (const v of variableMap) {
    const cur = values[v.name]?.value ?? null
    if (v.name in prev.current && prev.current[v.name] !== cur) flashed[v.name] = true
    prev.current[v.name] = cur
  }

  if (variableMap.length === 0) {
    return (
      <div className="vars-empty">
        {status === 'EMPTY' ? t('vars.empty.noProgram') : t('vars.empty.compiling')}
      </div>
    )
  }

  return (
    <div className="vars-view">
      {status !== 'RUNNING' && (
        <div className="vars-note">{t('vars.note.forceRunningOnly')}</div>
      )}
      <table className="vars-table">
        <thead>
          <tr>
            <th>{t('vars.col.name')}</th>
            <th>{t('vars.col.address')}</th>
            <th>{t('vars.col.type')}</th>
            <th className="v-col-val">{t('vars.col.value')}</th>
            <th className="v-col-force">{t('vars.col.force')}</th>
          </tr>
        </thead>
        <tbody>
          {variableMap.map((v) => {
            const isForced = forced.has(v.name)
            const raw = values[v.name]?.value ?? null
            const bool = isBool(v.type)
            const dir = directionClass(v.location)
            return (
              <tr key={v.index} className={flashed[v.name] ? 'flash' : ''}>
                <td className="v-name">
                  {isForced && <span className="v-lock" title={t('vars.force.held')}>🔒</span>}
                  {v.name}
                </td>
                <td className={'v-addr mono' + (dir ? ' v-dir ' + dir : '')}>{v.location || '—'}</td>
                <td className="v-type mono">{v.type}</td>
                <td className="v-col-val">
                  {raw === null || raw === undefined ? (
                    <span className="fc-na">—</span>
                  ) : bool ? (
                    <span className={'v-bool ' + (raw ? 't' : 'f')}>{raw ? 'TRUE' : 'FALSE'}</span>
                  ) : (
                    <span className="v-num mono">{typeof raw === 'object' ? JSON.stringify(raw) : String(raw)}</span>
                  )}
                </td>
                <td className="v-col-force"><ForceControls v={v} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
