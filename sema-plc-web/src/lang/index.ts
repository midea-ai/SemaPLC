/**
 * Language Module Index
 *
 * Re-exports ST language support for CodeMirror.
 */

export { structuredText, stLanguage, parser } from './st-language';
export { stHighlighting } from './st-highlight';
export {
  getSTDocumentation,
  formatDocumentationHTML,
  formatDocumentationText,
  FUNCTION_BLOCK_DOCS,
  DATA_TYPE_DOCS,
  KEYWORD_DOCS,
} from './st-docs';
export type { STDocumentation, ParameterDoc, ReturnDoc } from './st-docs';
