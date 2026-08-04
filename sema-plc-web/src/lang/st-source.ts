// OpenPLC 运行时要求 .st 末尾带 CONFIGURATION…END_CONFIGURATION(声明 resource + task),
// 但 lezer 语法与 rusty 的 --check 都只认 POU,对这段直接报语法错。可视化/诊断前先把它抹掉。
//
// 关键:用**等长空白**替换而不是删除 —— 剥离后的字符串与原文逐字符对齐,
// 偏移量、行号、列号天然 1:1,不需要任何 sourcemap 就能把 AST 的 loc / 诊断位置放回原文档。
// 前一版实现是 `src.match(/^([\s\S]*?END_PROGRAM)/i)`(截断到第一个 END_PROGRAM),
// 它会把 CONFIGURATION 之外的 FUNCTION_BLOCK 一起丢掉,而纯 FB 库文件没有 END_PROGRAM
// 则整个不匹配、原样送检。之所以一直没暴露,只是因为仓库样本 100% 是单 PROGRAM。
//
// 没有配对 END_CONFIGURATION 时(边打字边解析的中间态)不匹配,原样返回 —— 宁可多报几条错,
// 也不要把后面半个文件吞掉。
//
// 尾部要放行同行注释:`END_CONFIGURATION (* done *)` 是导出工具常见的写法,而这里是全有全无 ——
// 尾巴多一个字符就整段不剥,原文照送 lezer,幽灵错一条不少地全回来。
//
// 块注释只吃 `[^\n]`,**跨行不支持是有意的**:允许跨行就等于允许正则回溯到后文的下一个 `*)`。
// `END_CONFIGURATION (* a *) junk` 后面跟一个带注释的 FUNCTION_BLOCK 时,`[\s\S]` 会为了让
// 行尾锚点成立而一路吞到那个 POU 内部的 `*)`,把 FUNCTION_BLOCK 连头带注释抹成空白 ——
// 正好踩上面立的规矩「宁可多报几条错,也不要把后面半个文件吞掉」。跨行本来也不在需求内。
// 未闭合的 `(*` 同理匹配不上,退回不剥。
const CONFIGURATION_BLOCK =
  /^[ \t]*CONFIGURATION\b[\s\S]*?\bEND_CONFIGURATION[ \t]*;?[ \t]*(?:\(\*[^\n]*?\*\)|\/\/[^\n]*)?[ \t]*\r?$/gim

/** 把 CONFIGURATION 段替换成等长空白,长度与行数均不变。 */
export function stripConfigurationBlock(src: string): string {
  // 逐字符换空格但保留 \n:行数、每行长度都不变。`\r` 落在被抹区域里也换成空格,无害。
  return src.replace(CONFIGURATION_BLOCK, (m) => m.replace(/[^\n]/g, ' '))
}
