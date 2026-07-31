import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // ws 的两个可选原生加速模块:它内部是 try-require,装了才用。不 external 的话
  // esbuild 解析不到就直接报错,而它们对本地回环的这点流量毫无意义。
  external: ['vscode', 'bufferutil', 'utf-8-validate'],
  sourcemap: true,
  minify: !watch,
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[esbuild] watching…')
} else {
  await esbuild.build(options)
  console.log('[esbuild] dist/extension.js')
}
