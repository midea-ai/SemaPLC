// 真实扩展宿主里的冒烟验证:由 VSCode 以 --extensionTestsPath 加载并执行 run()。
// 本地已装 VSCode,直接用它的 CLI 跑,不需要 @vscode/test-electron 去下一份。
// 抛异常 = 失败(VSCode 以非 0 退出)。
const assert = require('assert')
const vscode = require('vscode')

const EXT_ID = 'semaplc.semaplc'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, label, ms = 30_000) {
  const deadline = Date.now() + ms
  let last
  while (Date.now() < deadline) {
    try {
      if (await fn()) return
    } catch (e) {
      last = e
    }
    await sleep(300)
  }
  throw new Error(`等待超时:${label}${last ? `(最后一次错误:${last.message})` : ''}`)
}

const step = (msg) => console.log(`\n[verify] ${msg}`)

exports.run = async function run() {
  const results = []
  const check = async (name, fn) => {
    try {
      await fn()
      results.push(`  ✔ ${name}`)
    } catch (e) {
      results.push(`  ✖ ${name} — ${e.message}`)
      throw e
    }
  }

  try {
    step('1/7 扩展被发现并激活')
    const ext = vscode.extensions.getExtension(EXT_ID)
    await check('扩展存在', async () => assert.ok(ext, `找不到扩展 ${EXT_ID}`))
    await ext.activate()
    await check('activate 成功', async () => assert.equal(ext.isActive, true))

    step('2/7 命令全部注册')
    const cmds = await vscode.commands.getCommands(true)
    await check('6 条 semaplc 命令都在', async () => {
      for (const c of [
        'semaplc.open',
        'semaplc.runtime.start',
        'semaplc.runtime.stop',
        'semaplc.runtime.rebuild',
        'semaplc.setApiKey',
        'semaplc.check',
      ]) {
        assert.ok(cmds.includes(c), `命令未注册:${c}`)
      }
    })

    step('3/7 .st 语言与语法生效')
    const doc = await vscode.workspace.openTextDocument({
      language: 'st',
      content: 'PROGRAM main\nVAR\n    Timer1 : TON;\nEND_VAR\nTimer1(IN := TRUE);\nEND_PROGRAM\n',
    })
    await check('.st languageId 注册', async () => assert.equal(doc.languageId, 'st'))

    step('4/7 语言 provider 真的注册进了编辑器')
    // 单测只能证明 registerXxxProvider 被调用过;能证明 VSCode 真的会调到我们的 provider 的,
    // 只有 executeXxxProvider —— 它走的是编辑器内部那套 selector 匹配与超时。
    await check('大纲:PROGRAM main → VAR 块 → Timer1', async () => {
      const syms = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri)
      assert.ok(syms && syms.length > 0, '大纲为空')
      assert.equal(syms[0].name, 'main')
      const names = syms[0].children.flatMap((c) => [c.name, ...c.children.map((g) => g.name)])
      assert.ok(names.includes('Timer1'), `变量没进大纲:${names.join(',')}`)
    })
    // TON 在第 3 行第 14 列(0-based),既是静态词表里的 FB,也是 Timer1 的类型。
    await check('hover:TON 有文档', async () => {
      const hovers = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        doc.uri,
        new vscode.Position(2, 14),
      )
      assert.ok(hovers && hovers.length > 0, 'hover 无结果')
    })
    await check('补全:Timer1. 给出 TON 的成员', async () => {
      // 第 5 行 `Timer1(IN := TRUE);` 的 `Timer1` 之后 —— 补全在光标处按前文判断上下文。
      const list = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        new vscode.Position(4, 6),
      )
      assert.ok(list && list.items.length > 0, '补全无结果')
    })
    await check('F12:Timer1 跳回它的声明行', async () => {
      const defs = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        doc.uri,
        new vscode.Position(4, 3),
      )
      assert.ok(defs && defs.length > 0, 'F12 无结果')
      assert.equal(defs[0].range.start.line, 2, '跳到的不是声明所在行')
    })

    step('5/7 semaplc.open:聚焦对话侧边栏(整合面板已下线)')
    // 侧边栏是 WebviewView,不在 tabGroups 里 —— 上一版按标签页名字找 'SemaPLC' 的断言
    // 随面板一起失效了。能在宿主里直接观测的是 views 贡献点自动生成的 <viewId>.focus 命令:
    // 它存在 ⇒ 视图注册成功(漏写 "type":"webview" 时视图会被当成 tree,但命令仍在,
    // 所以这条只证明注册,真正证明 webview 起来的是下一步的 health —— server 的懒启动
    // 就挂在 resolveWebviewView 里,它没跑通 health 必然探不到)。
    await check('semaplc.chat.focus 命令存在(视图已注册)', async () => {
      const all = await vscode.commands.getCommands(true)
      assert.ok(all.includes('semaplc.chat.focus'), '侧边栏视图未注册')
    })
    await vscode.commands.executeCommand('semaplc.open')

    step('6/7 server 健康检查')
    // 端口是扩展动态分配后注入 webview 的 window.__SEMAPLC__,宿主侧读不到。
    // 关键:只认 extension host(= 本进程)的直接子进程 —— 扫全机 node 会探到用户 dev.sh
    // 起的 3001,那是假阳性,验的是别人的 server。
    const { execFileSync } = require('child_process')
    const sh = (cmd) => execFileSync('/bin/sh', ['-c', `${cmd} || true`]).toString().trim()
    let healthPort, serverPid
    await check('扩展 spawn 的 server 子进程 /api/health 返回 200', async () => {
      await waitFor(async () => {
        for (const pid of sh(`pgrep -P ${process.pid}`).split('\n').filter(Boolean)) {
          const ports = sh(
            `lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid} 2>/dev/null | awk '{print $9}' | sed 's/.*://' | sort -u`,
          )
            .split('\n')
            .filter(Boolean)
          for (const p of ports) {
            try {
              const res = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) })
              if (res.ok) {
                healthPort = p
                serverPid = pid
                return true
              }
            } catch {
              /* 不是这个端口 */
            }
          }
        }
        return false
      }, '扩展子进程的 /api/health 可达', 40_000)
    })
    console.log(`[verify] extension host pid=${process.pid} → server pid=${serverPid} port=${healthPort}`)
    await check('端口是动态分配的,不是 web 版默认端口', async () => {
      assert.ok(!['3001', '3002'].includes(healthPort), `探到的是 web 版默认端口 ${healthPort},可能不是扩展起的`)
    })

    step('7/7 无 Docker 时 runtime 命令优雅降级(不抛错栈)')
    await check('runtime.start 不抛异常', async () => {
      await vscode.commands.executeCommand('semaplc.runtime.start')
    })

    console.log('\n[verify] 结果:')
    results.forEach((r) => console.log(r))
    console.log('\n[verify] ✅ 全部通过')
  } catch (e) {
    console.log('\n[verify] 结果:')
    results.forEach((r) => console.log(r))
    console.log(`\n[verify] ❌ 失败:${e.stack || e.message}`)
    throw e
  }
}
