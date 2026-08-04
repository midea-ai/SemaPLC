import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * `semaplc.envFile` 指向的 .env → 注入 server 进程的环境变量。
 *
 * 存在的理由:key 有两个互不相认的家 —— 内置 provider 的 *_API_KEY 走环境变量,
 * 而 web 版用 dev.sh 起时 `dataDir()` 落在 cwd,插件却指向 globalStorage(见
 * sema-plc-web/server/data-dir.ts)。在 web 版配好的 key 在插件里一个都看不到。
 * 指一个 .env 过来是最省事的打通方式,也不必把凭据复制到第二个地方。
 *
 * 不引 dotenv:要处理的就是 KEY=VALUE、注释、引号这几样,一个正则的事。
 */

/**
 * 扩展自己要控制的键,一律不许 .env 覆盖。
 *
 * PORT / WS_PORT 是重灾区:freePorts() 每次现挑一对空闲端口,被 .env 里的 3001/3002
 * 顶掉就直接端口冲突,server 起不来还看不出为什么。其余几个被顶掉会让 server 跑去
 * 服务另一个工作区 / 用错的 plc-tools 产物。
 */
const RESERVED = new Set([
  'PORT',
  'WS_PORT',
  'SEMAPLC_DATA_DIR',
  'PLC_WORKSPACE',
  'PLC_ENGINE',
  'PLC_TOOLS_DIST',
])

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 解析 .env 文本。支持 `KEY=VALUE`、`export KEY=VALUE`、`#` 注释、成对的单/双引号。
 *
 * ponytail: 不支持多行值(`KEY="line1\nline2"`)—— API key 和 baseURL 都是单行,
 * 真需要了再说。遇到时会把首行当值,不会串到下一行去。
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    if (!KEY_RE.test(key) || RESERVED.has(key)) continue
    let value = line.slice(eq + 1).trim()
    // 只脱成对的引号。裸值里的 # 不当注释处理:key 里出现 # 完全合法,
    // 而 dotenv 那套"未加引号时 # 起注释"的规则会把它从中间截断。
    const q = value[0]
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** `~` 展开 + 相对 base 解析。base 一般是当前工作区文件夹。 */
export function resolveEnvPath(file: string, base?: string): string {
  const expanded = file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file
  if (path.isAbsolute(expanded)) return expanded
  return path.resolve(base ?? os.homedir(), expanded)
}

/**
 * 读文件并解析。读不到只记一行日志、返回空对象 —— 路径写错不该让 server 起不来,
 * 那会把「少几个模型」变成「整个插件打不开」。
 */
export function loadEnvFile(file: string, log: (msg: string) => void): Record<string, string> {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    log(`[env] 读不到 semaplc.envFile:${file} —— ${e instanceof Error ? e.message : String(e)}`)
    return {}
  }
  const vars = parseEnvFile(text)
  // 只记键名,绝不记值 —— 这个 OutputChannel 用户会截图发出来。
  log(`[env] ${file}: 注入 ${Object.keys(vars).length} 个变量(${Object.keys(vars).join(', ') || '无'})`)
  return vars
}
