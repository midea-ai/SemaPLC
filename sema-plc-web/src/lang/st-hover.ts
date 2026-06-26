/**
 * Structured Text Hover Tooltips
 *
 * Provides hover documentation for ST keywords, function blocks, and types.
 * Uses CodeMirror's hoverTooltip extension.
 *
 * Phase 2: In-Context Help Implementation
 */

import { hoverTooltip } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { getSTDocumentation, formatDocumentationHTML } from './st-docs';

// ============================================================================
// Hover Tooltip Extension
// ============================================================================

/**
 * Creates a hover tooltip extension for ST documentation
 */
export function stHoverTooltip() {
  return hoverTooltip((view, pos, side) => {
    // Get the syntax tree at the current position
    const tree = syntaxTree(view.state);
    const node = tree.resolveInner(pos, side);

    // Skip if we're in a comment or string
    if (
      node.name === 'Comment' ||
      node.name === 'LineComment' ||
      node.name === 'BlockComment' ||
      node.name === 'String'
    ) {
      return null;
    }

    // Get the word at the position
    const wordRange = getWordAtPosition(view.state.doc.toString(), pos);
    if (!wordRange) return null;

    const word = view.state.doc.sliceString(wordRange.from, wordRange.to);

    // Look up documentation for the word
    const doc = getSTDocumentation(word);
    if (!doc) return null;

    // Return tooltip configuration
    return {
      pos: wordRange.from,
      end: wordRange.to,
      above: true,
      create(): { dom: HTMLElement } {
        const dom = document.createElement('div');
        dom.className = 'st-hover-tooltip';
        dom.innerHTML = formatDocumentationHTML(doc);
        return { dom };
      },
    };
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find word boundaries at a given position
 */
function getWordAtPosition(
  text: string,
  pos: number
): { from: number; to: number } | null {
  // Word characters: letters, digits, underscore
  const wordChar = /[a-zA-Z0-9_]/;

  // Check if position is in a word
  if (pos > 0 && pos < text.length && !wordChar.test(text[pos])) {
    // Try position - 1 (cursor might be after the word)
    pos--;
  }

  if (!wordChar.test(text[pos])) {
    return null;
  }

  // Find word start
  let from = pos;
  while (from > 0 && wordChar.test(text[from - 1])) {
    from--;
  }

  // Find word end
  let to = pos;
  while (to < text.length && wordChar.test(text[to])) {
    to++;
  }

  // Minimum word length (skip single characters like operators)
  if (to - from < 2) {
    return null;
  }

  return { from, to };
}
