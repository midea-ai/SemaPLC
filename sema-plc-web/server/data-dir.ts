import * as fs from 'fs'

// key-overrides.json / custom-models.json 的存放目录。缺省仍是仓库根(process.cwd(),
// 与历史行为完全一致);VS Code 扩展会传 SEMAPLC_DATA_DIR 指向 globalStorage。
// 目录不存在则递归创建(globalStorage 首次运行时可能还没建)。
export function dataDir(): string {
  const dir = process.env.SEMAPLC_DATA_DIR
  if (!dir) return process.cwd()
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}
