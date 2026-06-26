import * as path from 'path'

/**
 * Validate a filesystem path before it reaches an `fs.*` sink.
 *
 * - Rejects NUL bytes (poison-null-byte attacks) and non-string input.
 * - Returns the canonical absolute path (`path.resolve`). This is
 *   behaviour-preserving: `fs` already resolves relative paths against the
 *   same cwd, so wrapping a path here does not change which file is touched.
 * - When `base` is given, asserts the resolved path stays inside that base
 *   directory, blocking `../` traversal out of a permitted root.
 *
 * Centralising path construction here gives a single audited validation point
 * for every filesystem operation (defence against Path Manipulation).
 */
export function safePath(p: string, base?: string): string {
  if (typeof p !== 'string' || p.includes('\0')) {
    throw new Error('Invalid path: must be a string without NUL bytes')
  }
  const resolved = path.resolve(p)
  if (base !== undefined) {
    const root = path.resolve(base)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Invalid path: '${p}' escapes the permitted directory`)
    }
  }
  return resolved
}
