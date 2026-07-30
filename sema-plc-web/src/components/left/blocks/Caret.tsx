/**
 * 折叠指示三角。单条 chevron 路径 + 旋转,展开/收起是过渡动画而非换字形
 * (原来用 ▾/▸ 字符:字形自带大量内边距、看不清,且切换是硬跳)。
 * 位置由调用处的 CSS 决定(如 .tool-head.rich .caret{margin-left:auto})。
 */
export function Caret({ open }: { open: boolean }) {
  return (
    <svg className={'caret' + (open ? ' open' : '')} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
