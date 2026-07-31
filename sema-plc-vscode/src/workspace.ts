import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * PLC 工作区:设置覆盖 > 当前打开的文件夹(仅当它已经是 PLC 工作区)
 *              > ~/plc-workspace(web 版默认,已初始化则接着用)> 扩展专属目录。
 *
 * 绝不默认落到用户打开的代码库:server 一启动就往工作区铺 AGENTS.md / .sema/ / config/
 * (sema-bridge → setupWorkspaceIfNeeded),面板的「重置」更会 rm -rf 整个工作区
 * (sema-bridge → cleanWorkspace)。把用户的 React 仓库当工作区 = 点一次重置就没了。
 * 想在自己的项目里用,显式设 semaplc.workspace —— 那时风险是用户自己选的。
 */
export function resolveWorkspace(ctx: vscode.ExtensionContext): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  const override = vscode.workspace.getConfiguration('semaplc').get<string>('workspace')
  // 相对路径按打开的文件夹解析,不能用 path.resolve 的默认基准:扩展宿主的 cwd 在 macOS
  // 上随 VSCode 的启动方式漂移(Finder 启动是 '/',`code .` 冷启动是终端目录,复用已有
  // 实例时还是第一个窗口的目录)—— 同一份设置会静默解析到不同目录,而这个目录会被「重置」删光。
  if (override) return path.resolve(folder ?? os.homedir(), override)

  if (folder && isPlcWorkspace(folder)) return folder

  // web 版默认工作区:先用 sema-plc-web 建过工程的用户,装上扩展能直接接上。
  const legacy = path.join(os.homedir(), 'plc-workspace')
  if (isPlcWorkspace(legacy)) return legacy

  return path.join(ctx.globalStorageUri.fsPath, 'workspace')
}

/**
 * 判据与 package.json 的 workspaceContains 激活条件严格一致:只认 .sema/.mcp.json。
 *
 * 曾经放宽成「或顶层有 .st」,已撤回:.st 不是本产品独占的扩展名(Smalltalk fileout、
 * StringTemplate 都用它,扩展自己在 package.json 里抢注 .st 语言 ID 就说明这点),
 * 而顶层放 main.st 又恰恰是真实 PLC 工程仓库最常见的布局 —— 那条判据会在用户没做任何
 * 显式选择的情况下认领一个带 .git 的仓库,正好破掉上面那条不变量。
 * 想拿自己的项目当工作区,显式设 semaplc.workspace。
 */
export function isPlcWorkspace(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.sema', '.mcp.json'))
}

/**
 * plc-tools 的 state.json 落点。必须与 sema-plc-web/templates/.sema/.mcp.json 里的
 * PLC_STATE_FILE 保持一致,否则面板与 Copilot(MCP)各写各的 state,
 * 一边编译完另一边报 "No variable map found"。
 */
export function stateFileOf(workspace: string): string {
  return path.join(workspace, '.plc-vis', 'state.json')
}

/**
 * 工作区相关的 plc-tools 环境变量,与 sema-plc-web/templates/.sema/.mcp.json 的 env 块一一对应。
 * 少一个就是一处静默降级:缺 PLC_SCENE_FILE 时 plc_buildSimulation 校验通过却不落盘,
 * 仍返回 ok + "✓ 已构建过程仿真",面板的仿真图永远不更新;缺 PLC_IO_MAP_FILE 时
 * 部件提示层整段跳过,同一个程序两条路出的图不一样。
 */
export function workspaceEnv(workspace: string): Record<string, string> {
  return {
    PLC_WORKSPACE: workspace,
    PLC_STATE_FILE: stateFileOf(workspace),
    PLC_SCENE_FILE: path.join(workspace, 'config', 'scene.json'),
    PLC_IO_MAP_FILE: path.join(workspace, 'config', 'io_map.yaml'),
  }
}
