import { Component, type ReactNode, type ErrorInfo } from 'react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
  /** 兜底标题,缺省为通用文案。用于区分是哪个面板崩了。 */
  label?: string
}
interface State { error: Error | null }

/**
 * 局部错误边界:子树 render/生命周期抛错时不再冒泡到根(否则 React 卸载整棵树 → 整页白屏),
 * 改为就地显示可恢复的兜底 UI。「重试」清掉错误态、用当前 store 状态重渲——上游(如 agent
 * 重建 scene)修好后无需整页刷新即可恢复。注意:边界接不到事件处理器/异步里的抛错(那类也
 * 不会白屏),只接 render/生命周期/effect 的同步抛错。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#b91c1c', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <strong>⚠ {this.props.label ?? t('common.errorBoundary.defaultLabel')}</strong>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: '#7f1d1d', background: '#fef2f2', padding: '8px 10px', borderRadius: 6, maxWidth: '100%' }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={this.reset}
            style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
          >
            {t('common.retry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
