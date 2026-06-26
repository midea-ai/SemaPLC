import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from '../../../lib/codeHighlight'
import { useT } from '../../../i18n'

const CLAMP_LINES = 40

function CodeBlock({ lang, src }: { lang: string; src: string }) {
  const t = useT()
  const clean = src.replace(/\n$/, '')
  return (
    <pre>
      <button type="button" className="md-copy" onClick={() => navigator.clipboard?.writeText(clean)}>{t('tools.copy')}</button>
      <code>{clean.split('\n').map((l, i) => (<span key={i}>{highlight(lang, l, i)}{'\n'}</span>))}</code>
    </pre>
  )
}

function Inner({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const m = /language-(\w+)/.exec(className ?? '')
          const src = String(children ?? '')
          if (!m && !src.includes('\n')) return <code className={className}>{children}</code>
          const lang = m?.[1] ?? 'st'
          return <CodeBlock lang={lang === 'json' ? 'json' : lang === 'yaml' || lang === 'toml' ? lang : 'st'} src={src} />
        },
      }}
    >{text}</ReactMarkdown>
  )
}

export function MarkdownText({ text }: { text: string }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const longe = text.split('\n').length > CLAMP_LINES
  if (!longe || expanded) {
    return (
      <div className="md-wrap">
        <Inner text={text} />
        {longe && <button type="button" className="md-toggle" onClick={() => setExpanded(false)}>{t('tools.collapse')}</button>}
      </div>
    )
  }
  const head = text.split('\n').slice(0, CLAMP_LINES).join('\n')
  return (
    <div className="md-wrap clamped">
      <Inner text={head} />
      <button type="button" className="md-toggle" onClick={() => setExpanded(true)}>{t('tools.expandAll')}</button>
    </div>
  )
}
