import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { resolveWorkspace, workspaceEnv } from './workspace'
import { knownEngine } from './runtime-guide'

/**
 * MCP 注册(方案 §4.8):把 plc-tools 以 stdio MCP server 暴露给 Copilot agent mode
 * 等任何走 VSCode MCP 的助手 —— 用户不打开 SemaPLC 面板也能用 plc_* 工具。
 *
 * activeWorkspace:server 正在服务的工作区(没起 server 时返回 undefined)。
 * 返回一个 refresh 函数 —— 定义是懒算且一直缓存到事件触发为止,而 resolveWorkspace 的
 * 结果取决于文件系统状态(.sema/.mcp.json 是否存在),配置和文件夹事件都盖不住它。
 */
export function registerMcpProvider(
  ctx: vscode.ExtensionContext,
  activeWorkspace: () => string | undefined,
): () => void {
  const changed = new vscode.EventEmitter<void>()
  const version = ctx.extension.packageJSON.version as string

  ctx.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('semaplc')) changed.fire()
    }),
    // 换文件夹会改变 resolveWorkspace 的结果,定义里的 PLC_WORKSPACE 得跟着重算。
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.lm.registerMcpServerDefinitionProvider('semaplc.plcTools', {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        // vendor(打包后)优先,回退 monorepo 开发路径
        const cli = [
          path.join(ctx.extensionPath, 'vendor', 'plc-tools', 'dist', 'cli.js'),
          path.join(ctx.extensionPath, '..', 'sema-plc-tools', 'dist', 'cli.js'),
        ].find((p) => fs.existsSync(p))
        if (!cli) return [] // 未打包/未构建时静默不提供,不报错

        const cfg = vscode.workspace.getConfiguration('semaplc')
        const env: Record<string, string> = {}
        const put = (key: string, value: string | undefined) => {
          if (value) env[key] = value
        }
        put('PLC_URL', cfg.get<string>('plcUrl'))
        put('PLC_CONTAINER', cfg.get<string>('container.name'))
        put('PLC_DOCKER_BIN', cfg.get<string>('container.bin'))
        // 同 server-manager:无引擎时 Copilot 那侧也只该看到纯本地工具。这里不能 await
        // (provide 是同步的),所以只用已探到的结果 —— undefined(还没探过)时什么都不注入,
        // 宁可多给几个工具,也不能凭没探测过就断言"无引擎"把工具表清空。
        if (knownEngine() === null) env.PLC_ENGINE = 'none'
        // 不传这些,plc-tools 会回落到全局默认 ~/.plc-tools/state.json,与面板用的
        // $WORKSPACE/.plc-vis/state.json 是两份:Copilot 编译完面板看不到变量表,
        // 反之 plc_readVariables 报 "No variable map found" 而用户明明刚编译过。
        // server 在跑时以它实际服务的工作区为准。
        // ponytail: 覆盖不到「面板内双击顶栏切换工作区」—— 那条路只改 server 进程内的
        // this.workspace,扩展无从知晓,Copilot 会继续用切换前的路径(两份 state,但不会
        // 丢数据)。要补的话得让 server 把 workspace:ready 转给扩展再 fire 一次刷新。
        Object.assign(env, workspaceEnv(activeWorkspace() ?? resolveWorkspace(ctx)))

        return [
          new vscode.McpStdioServerDefinition(
            'SemaPLC PLC Tools',
            process.execPath,
            [cli, 'serve', '--lite'],
            env,
            version,
          ),
        ]
      },
    }),
  )

  return () => changed.fire()
}
