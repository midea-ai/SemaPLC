import * as fs from 'fs'
import * as path from 'path'

// 用户自定义模型列表(多条,可增删切换)。持久化到仓库根的 custom-models.json,
// 与 .env 并列、已在 .gitignore。首次加载时若文件不存在,则从旧的单槽
// PLC_OPENAI_COMPATIBLE_* 迁移出第一条,保证老配置不丢。
export type CustomModelEntry = {
  id: string            // 稳定短随机 id,形如 "custom:a1b2c3";用于 model:switch 与注册表 key
  baseURL: string
  modelName: string
  apiKey: string
  adapt: 'openai' | 'anthropic'
}

const FILE = path.join(process.cwd(), 'custom-models.json')
let cache: CustomModelEntry[] | null = null

function genId(existing: CustomModelEntry[]): string {
  let id: string
  do { id = 'custom:' + Math.random().toString(36).slice(2, 8) } while (existing.some((e) => e.id === id))
  return id
}

function isEntry(x: unknown): x is CustomModelEntry {
  const e = x as CustomModelEntry
  return !!e && typeof e.id === 'string' && typeof e.baseURL === 'string'
    && typeof e.modelName === 'string' && typeof e.apiKey === 'string'
    && (e.adapt === 'openai' || e.adapt === 'anthropic')
}

// 旧单槽迁移:.env 里若有完整的 PLC_OPENAI_COMPATIBLE_* 就转成一条列表项。
function seedFromEnv(env: NodeJS.ProcessEnv): CustomModelEntry | null {
  const baseURL = env.PLC_OPENAI_COMPATIBLE_BASE_URL
  const modelName = env.PLC_OPENAI_COMPATIBLE_MODEL
  const apiKey = env.PLC_OPENAI_COMPATIBLE_API_KEY
  if (!baseURL || !modelName || !apiKey) return null
  const adapt = env.PLC_OPENAI_COMPATIBLE_PROVIDER === 'anthropic' ? 'anthropic' : 'openai'
  return { id: 'custom:' + Math.random().toString(36).slice(2, 8), baseURL, modelName, apiKey, adapt }
}

function save(list: CustomModelEntry[]): void {
  try { fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n', 'utf8') } catch {}
}

function load(env: NodeJS.ProcessEnv): CustomModelEntry[] {
  if (fs.existsSync(FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      if (Array.isArray(arr)) return arr.filter(isEntry)
    } catch {}
    return []
  }
  const seed = seedFromEnv(env)
  const list = seed ? [seed] : []
  save(list)
  return list
}

export function listCustomModels(env: NodeJS.ProcessEnv = process.env): CustomModelEntry[] {
  if (!cache) cache = load(env)
  return cache
}

export function getCustomModel(id: string, env: NodeJS.ProcessEnv = process.env): CustomModelEntry | undefined {
  return listCustomModels(env).find((e) => e.id === id)
}

export function addCustomModel(input: Omit<CustomModelEntry, 'id'>, env: NodeJS.ProcessEnv = process.env): CustomModelEntry {
  const list = listCustomModels(env)
  const entry: CustomModelEntry = { id: genId(list), ...input }
  list.push(entry)
  save(list)
  return entry
}

export function deleteCustomModel(id: string, env: NodeJS.ProcessEnv = process.env): void {
  cache = listCustomModels(env).filter((e) => e.id !== id)
  save(cache)
}
