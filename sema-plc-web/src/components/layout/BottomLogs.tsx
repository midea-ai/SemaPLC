import { useMemo, useRef, useState, useEffect } from 'react'
import { useLogsStore, type LogEntry } from '../../store/logs'
import { useT } from '../../i18n'
import './logs-view.css'

type Filter = 'all' | 'compile' | 'runtime' | 'tool'


function matchesFilter(source: LogEntry['source'], filter: Filter): boolean {
  switch (filter) {
    case 'all':     return true
    case 'compile': return source === 'iec2c' || source === 'gcc'
    case 'runtime': return source === 'runtime'
    case 'tool':    return source === 'tool'
  }
}

function fmt(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

function prettyJson(data: unknown): string {
  if (data == null) return '—'
  if (typeof data === 'string') {
    // May be a truncated JSON string ending with …(truncated)
    try { return JSON.stringify(JSON.parse(data), null, 2) } catch { return data }
  }
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}

function isToolEntry(e: LogEntry): boolean {
  return e.source === 'tool' && e.toolName != null
}

export function BottomLogs() {
  const t = useT()
  const entries = useLogsStore((s) => s.entries)
  const clear = useLogsStore((s) => s.clear)
  const [filter, setFilter] = useState<Filter>('all')

  const filterTabs: { key: Filter; label: string }[] = [
    { key: 'all', label: t('logs.filter.all') },
    { key: 'compile', label: t('logs.filter.compile') },
    { key: 'runtime', label: t('logs.filter.runtime') },
    { key: 'tool', label: t('logs.filter.tool') },
  ]
  // Keyed by LogEntry.id (stable), NOT array index — indexes shift when new logs
  // stream in or the 500-entry cap trims the head, which closed/relocated the panel.
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const shown = useMemo(
    () => entries.filter((e) => matchesFilter(e.source, filter)),
    [entries, filter],
  )

  const listRef = useRef<HTMLDivElement>(null)
  // Pause auto-scroll while the pointer is inside the list: otherwise new entries
  // shift rows under the cursor and the hover tooltip jumps to a different row.
  const [hovering, setHovering] = useState(false)
  useEffect(() => {
    if (!hovering && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [shown.length, hovering])

  return (
    <div className="logs-panel">
      <div className="logs-bar">
        <div className="logs-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              className={'logs-tab' + (filter === tab.key ? ' active' : '')}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="logs-count">{t('logs.count', { n: shown.length })}</span>
        <button className="logs-clear" onClick={clear}>{t('logs.clear')}</button>
      </div>

      <div
        className="logs-view"
        ref={listRef}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {shown.length === 0 && <div className="logs-empty">{t('logs.empty')}</div>}
        {shown.map((e) => {
          const isTool = isToolEntry(e)
          const isExpanded = expandedId === e.id
          return (
            <div key={e.id}>
              <div
                className={'log-line' + (isTool ? ' tool-row' : '') + (isExpanded ? ' expanded' : '')}
                onClick={isTool ? () => setExpandedId(isExpanded ? null : e.id) : undefined}
              >
                <span className="log-t">{fmt(e.ts)}</span>
                <span className={'log-kind ' + e.source}>[{e.source}]</span>
                <span className={'log-msg' + (e.level !== 'info' ? ' ' + e.level : '')}>
                  {e.level === 'error' && <span className="log-mark error">!</span>}
                  {e.level === 'warn' && <span className="log-mark warn">!</span>}
                  {e.message}
                </span>
                {/* Hover tooltip — hidden when row is expanded */}
                {isTool && !isExpanded && (
                  <div className="tool-tooltip">
                    <div className="tool-tooltip-section">
                      <span className="tool-tooltip-label">{t('logs.io.input')}</span>
                      <pre>{prettyJson(e.toolInput)}</pre>
                    </div>
                    <div className="tool-tooltip-section">
                      <span className="tool-tooltip-label">{t('logs.io.output')}</span>
                      <pre>{prettyJson(e.toolOutput)}</pre>
                    </div>
                  </div>
                )}
              </div>
              {/* Inline expanded detail panel */}
              {isTool && isExpanded && (
                <div className="tool-detail">
                  <div className="tool-detail-section">
                    <span className="tool-detail-label">{t('logs.io.input')}</span>
                    <pre className="tool-detail-json">{prettyJson(e.toolInput)}</pre>
                  </div>
                  <div className="tool-detail-section">
                    <span className="tool-detail-label">{t('logs.io.output')}</span>
                    <pre className="tool-detail-json">{prettyJson(e.toolOutput)}</pre>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
