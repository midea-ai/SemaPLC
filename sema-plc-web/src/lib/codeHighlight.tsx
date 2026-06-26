import { Fragment, type ReactNode } from 'react'

// ── syntax highlighting (ported from the SemaPLC design) ──
const ST_RE = /(\(\*[^]*?\*\))|(%[IQM][XWB]?[0-9.]+)|(T#[0-9a-zA-Z]+)|\b(PROGRAM|END_PROGRAM|FUNCTION_BLOCK|END_FUNCTION_BLOCK|FUNCTION|END_FUNCTION|VAR|VAR_INPUT|VAR_OUTPUT|VAR_GLOBAL|END_VAR|CONFIGURATION|END_CONFIGURATION|RESOURCE|END_RESOURCE|TASK|CASE|OF|END_CASE|IF|THEN|ELSE|ELSIF|END_IF|FOR|TO|DO|END_FOR|WHILE|END_WHILE|AT|WITH|ON|PRIORITY|INTERVAL|NOT|AND|OR)\b|\b(BOOL|INT|SINT|DINT|UINT|UDINT|WORD|REAL|TIME|TON|TOF|TP|CTU|CTD|R_TRIG|F_TRIG)\b|\b(TRUE|FALSE)\b|\b(\d+)\b/g

function hi(line: string, re: RegExp, classOf: (m: RegExpExecArray) => string, key: number): ReactNode {
  const out: ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, i = 0
  re.lastIndex = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    out.push(<span key={i++} className={classOf(m)}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return <Fragment key={key}>{out}</Fragment>
}
const stClass = (m: RegExpExecArray) => m[1] ? 'tk-com' : m[2] ? 'tk-addr' : m[3] ? 'tk-time' : m[4] ? 'tk-kw' : m[5] ? 'tk-type' : m[6] ? 'tk-bool' : 'tk-num'
const JSON_RE = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|\b(-?\d+\.?\d*)\b/g
const jsonClass = (m: RegExpExecArray) => m[1] ? 'tk-type' : m[2] ? 'tk-addr' : m[3] ? 'tk-bool' : 'tk-num'

function hlVal(v: string, k: string): ReactNode {
  if (/^".*"$/.test(v)) return <span key={k} className="tk-addr">{v}</span>
  if (/^(true|false)$/.test(v.trim())) return <span key={k} className="tk-bool">{v}</span>
  if (/^-?\d/.test(v.trim())) return <span key={k} className="tk-num">{v}</span>
  return v
}
export function highlight(lang: string, line: string, key: number): ReactNode {
  if (lang === 'json') return hi(line, JSON_RE, jsonClass, key)
  if (lang === 'yaml' || lang === 'toml') {
    if (/^\s*#/.test(line)) return <span key={key} className="tk-com">{line}</span>
    if (lang === 'toml' && /^\s*\[/.test(line)) return <span key={key} className="tk-kw">{line}</span>
    const m = line.match(/^(\s*)(- )?([A-Za-z0-9_.\-]+)(\s*[:=]\s*)(.*)$/)
    if (m) return <Fragment key={key}>{m[1]}{m[2] && <span className="tk-num">{m[2]}</span>}<span className="tk-type">{m[3]}</span>{m[4]}{m[5] ? hlVal(m[5], 'v') : ''}</Fragment>
    return line
  }
  return hi(line, ST_RE, stClass, key)  // st / default
}
