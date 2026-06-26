import type { ToolBlockResult } from '../../../../../shared/protocol'
import { t } from '../../../../i18n'

export type ParsedResult =
  | { kind: 'ok'; data: any }
  | { kind: 'truncated'; rawBytes?: number; content: string }
  | { kind: 'raw'; text: string }

/** 解析工具 result.content;先判 16KB 截断 flag,再 try JSON,失败回落 raw。 */
export function parseResult(result?: ToolBlockResult): ParsedResult {
  if (!result || result.content === '' || result.content == null) return { kind: 'raw', text: '' }
  if (result.truncated) return { kind: 'truncated', rawBytes: result.rawBytes, content: result.content }
  try {
    return { kind: 'ok', data: JSON.parse(result.content) }
  } catch {
    return { kind: 'raw', text: result.content }
  }
}

/** capInput(>8KB) 把 input 换成 { _truncated:true, _rawBytes, preview }。 */
export function isInputTruncated(input: unknown): input is { _truncated: true; preview: string; _rawBytes?: number } {
  return typeof input === 'object' && input !== null && (input as any)._truncated === true
}

/** 截断时的人类可读提示。 */
export function truncatedNote(rawBytes?: number): string {
  const kb = rawBytes ? Math.round(rawBytes / 1024) : undefined
  return kb ? t('tools.parse.truncatedWithSize', { kb }) : t('tools.parse.truncatedNoSize')
}
