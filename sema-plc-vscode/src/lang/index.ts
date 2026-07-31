import * as vscode from 'vscode'
import { forgetSt } from './ast'
import { stSymbolProvider } from './symbols'
import { stDefinitionProvider, stHighlightProvider } from './definition'
import { stHoverProvider } from './hover'
import { stCompletionProvider, ST_COMPLETION_TRIGGERS } from './completion'
import { registerStDiagnostics } from './diagnostics'

/**
 * .st 语言支持的唯一接线点(方案 §5 第 1 步)。
 *
 * 必须在 activate() 里**无条件**调用:语言能力不能等用户先开面板,
 * 否则双击 .st 打开原生 tab 时什么都没有(activationEvents 的 onLanguage:st 已保证时机)。
 */

// scheme 不限定:untitled(还没存盘的新文件)和 git diff 视图里的 .st 一样该有大纲和 hover。
const ST: vscode.DocumentSelector = { language: 'st' }

export function activateStLanguage(ctx: vscode.ExtensionContext, out: vscode.OutputChannel): void {
  ctx.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(ST, stSymbolProvider),
    vscode.languages.registerDefinitionProvider(ST, stDefinitionProvider),
    vscode.languages.registerDocumentHighlightProvider(ST, stHighlightProvider),
    vscode.languages.registerHoverProvider(ST, stHoverProvider),
    vscode.languages.registerCompletionItemProvider(ST, stCompletionProvider, ...ST_COMPLETION_TRIGGERS),
    // ast.ts 的缓存是模块级 Map,少了这一句就是纯泄漏:一个会话里开过的每个文件的整棵 AST
    // 都挂到进程结束。diagnostics 自己也听 close(它清的是 Problems 面板,两件事)。
    vscode.workspace.onDidCloseTextDocument((doc) => forgetSt(doc.uri.toString())),
  )
  // 自己 push 全部 disposable,返回的 collection 这里用不上(通道 B 在第 3 步另建一个)。
  registerStDiagnostics(ctx, out)
}
