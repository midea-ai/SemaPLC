// esbuild inject:给被打进 ESM 产物的 CJS 依赖补上 require/__filename/__dirname。
// inject 只替换「未绑定」的标识符,所以 server 自己声明了 __filename 的模块不受影响。
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

export const require = createRequire(import.meta.url)
export const __filename = fileURLToPath(import.meta.url)
export const __dirname = dirname(__filename)
