// 把 sema-plc-web/server/index.ts 连同依赖(含 sema-core)打成单文件,供 VSIX 内 spawn。
// 输出 ESM(.mjs):server 源码用了 import.meta.url(config.ts / http-server.ts /
// workspace-setup.ts),ESM 下原生可用,无需 banner shim。
// external:
//   - @vscode/ripgrep 只导出二进制路径,bundle 无意义,二进制由 build-vsix.sh 单独拷贝;
//   - 其余带原生 .node 的可选依赖(sema-core 里 try/require 的图像/终端相关)同理。
import * as esbuild from 'esbuild'
import * as path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..', 'sema-plc-web')
const outfile = process.env.OUT ?? path.join(here, 'vendor', 'server', 'server.bundle.mjs')

await esbuild.build({
  entryPoints: [path.join(webRoot, 'server', 'index.ts')],
  bundle: true,
  outfile,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  absWorkingDir: webRoot, // 让 node_modules 解析落在 sema-plc-web
  // turndown 等是 sema-core 里 require() 的可选依赖(未安装,运行时 try/catch 兜底)。
  external: ['@vscode/ripgrep', 'turndown'],
  // sema-core 及其依赖是 CJS,内部用 require/__dirname/__filename;esm 产物里没有,inject 补上。
  // 不能用 banner:server 自己的 http-server.ts 顶层声明了 __filename,会重复声明报错。
  inject: [path.join(here, 'scripts', 'cjs-shim.mjs')],
  // depd 等 CJS 依赖用的是「动态 require」(require(变量)),esbuild 只能生成运行时 stub,
  // 该 stub 会先看作用域里有没有 require;挂到 globalThis 上即可让它走真 require。
  // 用 globalThis 而不是 const,避免和 inject / 用户代码的同名声明打架。
  banner: {
    js: "import{createRequire as __semaCR}from'module';globalThis.require??=__semaCR(import.meta.url);",
  },
  logLevel: 'info',
  sourcemap: false,
  minify: false,
})
console.log('[esbuild] ' + outfile)

// plc-tools 的 cli.js 会被 sema-core 按 .sema/.mcp.json 作为 MCP stdio 子进程 spawn,
// 是 vendor/plc-tools/dist 里唯一真正被 node 执行的文件(其余模块已内联进 server bundle)。
// 同样打成自包含单文件,VSIX 里就不必带 plc-tools 的 node_modules(94MB)。
const cliOut = path.join(here, 'vendor', 'plc-tools', 'dist', 'cli.js')
await esbuild.build({
  entryPoints: [path.resolve(here, '..', 'sema-plc-tools', 'dist', 'cli.js')],
  bundle: true,
  outfile: cliOut,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  allowOverwrite: true, // build-vsix.sh 先 cp -R dist,再由本步覆盖 cli.js
  banner: { js: "import{createRequire as __semaCR}from'module';globalThis.require??=__semaCR(import.meta.url);" },
  logLevel: 'info',
  sourcemap: false,
  minify: false,
})
console.log('[esbuild] ' + cliOut)
