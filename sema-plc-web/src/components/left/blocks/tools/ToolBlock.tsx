import { ToolCallCard, type ToolCardData } from '../ToolCallCard'
import { pickRenderer, isHiddenTool } from './registry'

export function ToolBlock({ data }: { data: ToolCardData }) {
  if (isHiddenTool(data.toolName)) return null
  const Renderer = pickRenderer(data.toolName)
  if (Renderer) return <Renderer data={data} />
  return <ToolCallCard data={data} />
}
