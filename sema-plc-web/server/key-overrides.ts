import * as fs from 'fs'
import * as path from 'path'

// 用户经 UI 为「未配置」的内置已验证模型填入的 API key。持久化到仓库根的
// key-overrides.json(与 .env / custom-models.json 并列、已在 .gitignore)。存的是
// envKey→值 的映射,例如 { "DEEPSEEK_API_KEY": "sk-..." }。
//
// 启动时 applyKeyOverrides() 把它 merge 进 process.env,但 .env/shell 已设的同名变量
// 优先(不覆盖)——保证 .env 仍是权威来源,UI 填的只补 .env 里缺的那些。
const FILE = path.join(process.cwd(), 'key-overrides.json')
let cache: Record<string, string> | null = null

function load(): Record<string, string> {
  if (cache) return cache
  try {
    if (fs.existsSync(FILE)) {
      const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        cache = Object.fromEntries(
          Object.entries(obj).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'),
        ) as Record<string, string>
        return cache
      }
    }
  } catch {}
  cache = {}
  return cache
}

function save(map: Record<string, string>): void {
  try { fs.writeFileSync(FILE, JSON.stringify(map, null, 2) + '\n', 'utf8') } catch {}
}

// 启动时调用:把已保存的 override 注入 process.env,但不覆盖 .env/shell 已设的同名变量。
export function applyKeyOverrides(env: NodeJS.ProcessEnv = process.env): void {
  const map = load()
  for (const [k, v] of Object.entries(map)) {
    if (!env[k]) env[k] = v
  }
}

// UI 填 key:持久化并即时生效(写 process.env,后续 buildModelRegistry 立刻读到)。
export function saveKeyOverride(envKey: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  const map = load()
  map[envKey] = value
  save(map)
  env[envKey] = value
}
