// ServerManager / resolveWorkspace 只用到 vscode 的一小撮 API,测试里用这些空壳顶掉
// (esbuild alias 注入)。可变部分放 state,测试通过 exports.__state 改。
const noopDisposable = { dispose() {} }

// config: semaplc.* 设置项;folders: workspaceFolders(undefined = 没打开文件夹)。
// 挂 globalThis:esbuild 把这个 stub 打进被测 bundle 里,测试自己 require 的是另一份实例 ——
// 两份模块必须共享同一个 state,否则测试改了设置产品代码读不到。
const state = (globalThis.__SEMAPLC_TEST_STATE__ ??= { config: {}, folders: undefined, calls: [] })

// 记下每次注册动作。接线测试靠它断言 provider 真的注册了,并反手触发监听器
// (真实 vscode 里这些回调只有编辑器能调,不记下来就没法验)。
const rec = (kind, payload) => {
  state.calls.push({ kind, ...payload })
  return noopDisposable
}

module.exports = {
  __state: state,
  // bus.attach()/onMessage() 返回 new vscode.Disposable(fn) —— 真货就是「记住一个函数,
  // dispose 时调它」,照此实现即可。
  Disposable: class Disposable {
    constructor(fn) {
      this._fn = fn
    }
    dispose() {
      this._fn?.()
    }
  },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id
    }
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 15 },
  EventEmitter: class EventEmitter {
    constructor() {
      this.event = () => noopDisposable
    }
    fire() {}
    dispose() {}
  },
  workspace: {
    // 默认 state.config 为空 ⇒ get 返回 undefined ⇒ 走产品代码里的默认值分支
    getConfiguration: () => ({
      get: (key) => state.config[key],
      // 真实 inspect 用来区分「用户显式设过」和「只是默认值」。stub 里 state.config
      // 放什么就算显式设过(globalValue),没放的键 inspect 返回全 undefined ——
      // 与 VSCode 对一个只有 default 的配置项的行为一致。
      inspect: (key) => ({
        key,
        globalValue: state.config[key],
        workspaceValue: undefined,
        workspaceFolderValue: undefined,
      }),
    }),
    onDidChangeConfiguration: () => noopDisposable,
    onDidChangeWorkspaceFolders: () => noopDisposable,
    onDidSaveTextDocument: (handler) => rec('onDidSave', { handler }),
    onDidCloseTextDocument: (handler) => rec('onDidClose', { handler }),
    get workspaceFolders() {
      return state.folders
    },
  },
  languages: {
    registerDocumentSymbolProvider: (sel, provider) => rec('documentSymbol', { sel, provider }),
    registerDefinitionProvider: (sel, provider) => rec('definition', { sel, provider }),
    registerDocumentHighlightProvider: (sel, provider) => rec('documentHighlight', { sel, provider }),
    registerHoverProvider: (sel, provider) => rec('hover', { sel, provider }),
    registerCompletionItemProvider: (sel, provider, ...triggers) => rec('completion', { sel, provider, triggers }),
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    showErrorMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    withProgress: (_opts, task) => task(),
  },
  commands: {
    executeCommand: () => Promise.resolve(undefined),
    registerCommand: (id, handler) => rec('command', { id, handler }),
  },
  Uri: { file: (p) => ({ fsPath: p }) },
}
