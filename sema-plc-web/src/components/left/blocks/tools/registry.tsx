import type { ToolCardData } from '../ToolCallCard'
import { shortName } from '../ToolCallCard'

export type ToolRenderer = (props: { data: ToolCardData }) => JSX.Element

// toolName 后缀 → 渲染器。各 block 任务往这里加条目。
const RENDERERS: Record<string, ToolRenderer> = {}

export function registerRenderer(suffix: string, r: ToolRenderer) { RENDERERS[suffix] = r }

export function pickRenderer(toolName: string): ToolRenderer | null {
  const sn = shortName(toolName)
  return RENDERERS[sn] ?? null
}

// PlanCard 已接管 todo,这些工具块不在对话流渲染。
const HIDDEN = new Set(['create_todo', 'update_todo', 'list_todos'])
export function isHiddenTool(toolName: string): boolean { return HIDDEN.has(shortName(toolName)) }

import { VarsBlock } from './VarsBlock'
registerRenderer('plc_readVariables', VarsBlock)

import { ForceBlock } from './ForceBlock'
registerRenderer('plc_forceVariables', ForceBlock)

import { CompileBlock } from './CompileBlock'
registerRenderer('plc_buildAndRun', CompileBlock)
registerRenderer('plc_compile', CompileBlock)

import { VerifyBlock } from './VerifyBlock'
registerRenderer('plc_verifyBehavior', VerifyBlock)
registerRenderer('plc_waitFor', VerifyBlock)

import { TraceBlock } from './TraceBlock'
registerRenderer('plc_trace', TraceBlock)

import { ShellBlock } from './ShellBlock'
registerRenderer('run_shell', ShellBlock)

import { EditBlock } from './EditBlock'
registerRenderer('write_file', EditBlock)
registerRenderer('patch_file', EditBlock)

import { ReadBlock } from './ReadBlock'
registerRenderer('view_file', ReadBlock)

import { SkillBlock } from './SkillBlock'
registerRenderer('skill', SkillBlock)
