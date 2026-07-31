// 产物新鲜度:改了 sema-plc-web 的源码却忘了重建,是本项目连续踩了三轮的坑。
//
// 危险在于它静默:三个产物目录全在 .gitignore 里(git 不提醒),单测直接测源码(测试照样全绿),
// 只有真跑起来才暴露。而且后果不是"新功能没生效"这么轻——最狠的一次是 vendor/server 停留在
// 旧版 check 路由(无 stdlib 过滤),配上已经删掉前端过滤的新 webview,干净文件会报 28 条
// stdlib 错,比修之前更糟。
//
// 这里只做"产物不能旧于源码"这一条最粗的检查。产物不存在(纯开发树、CI)就跳过 ——
// 缺产物有 resolveWebRoot / firstExisting 的回退路径管,不是这个测试的职责。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.resolve(extRoot, '..', 'sema-plc-web')

/** 目录下最新一个文件的 mtimeMs;目录不存在返回 0。 */
function newestMtime(dir, skip = /node_modules|dist|\.vite/) {
  if (!fs.existsSync(dir)) return 0
  let newest = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.test(e.name)) continue
    const p = path.join(dir, e.name)
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p, skip) : fs.statSync(p).mtimeMs)
  }
  return newest
}

const fmt = (ms) => new Date(ms).toTimeString().slice(0, 8)

// [产物, 它由哪些源码目录决定, 重建命令]
const ARTIFACTS = [
  {
    artifact: path.join(extRoot, 'media', 'web', 'index.html'),
    sources: [path.join(webRoot, 'src')],
    rebuild: 'cd sema-plc-web && npx vite build && rsync -a --delete dist/ ../sema-plc-vscode/media/web/',
    why: 'panel.ts 的 resolveWebRoot 优先读 media/web,过期 = 面板跑的是旧前端',
  },
  {
    artifact: path.join(extRoot, 'vendor', 'server', 'server.bundle.mjs'),
    sources: [path.join(webRoot, 'server'), path.join(webRoot, 'shared')],
    rebuild: 'cd sema-plc-vscode && node esbuild.server.mjs',
    why: 'server-manager.ts 的 firstExisting 第一候选,过期 = 扩展 spawn 的是旧 server',
  },
  {
    // 扩展自己的产物。package.json 的 main 指向它,开发态(--extensionDevelopmentPath)与 VSIX 都跑它。
    artifact: path.join(extRoot, 'dist', 'extension.js'),
    sources: [path.join(extRoot, 'src')],
    rebuild: 'cd sema-plc-vscode && node esbuild.mjs',
    why: 'package.json 的 main,过期 = 扩展跑的是旧代码(改了 src 却没重新 bundle)',
  },
]

for (const { artifact, sources, rebuild, why } of ARTIFACTS) {
  const rel = path.relative(extRoot, artifact)
  test(`产物不旧于源码:${rel}`, { skip: fs.existsSync(artifact) ? false : '产物不存在(纯开发树)' }, () => {
    const built = fs.statSync(artifact).mtimeMs
    const src = Math.max(...sources.map((s) => newestMtime(s)))
    assert.ok(
      built >= src,
      `${rel} 比源码旧(产物 ${fmt(built)} < 源码 ${fmt(src)})。\n` +
        `  影响:${why}\n` +
        `  重建:${rebuild}\n` +
        `  或整体重建:sema-plc-vscode/scripts/build-vsix.sh`,
    )
  })
}
