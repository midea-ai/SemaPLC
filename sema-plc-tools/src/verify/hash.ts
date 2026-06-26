import { createHash } from 'crypto'

export function stHashOf(stCode: string): string {
  return 'sha256:' + createHash('sha256').update(stCode).digest('hex')
}
