# 前端界面

前端是 Vite + React 18 应用(`sema-plc-web/src/`),经 WebSocket(`:3002`)接收后端推送,`/api/*` 代理到 `:3001`。

## 布局

根组件 `src/App.tsx`:顶部 `TopBar`,下方水平 `PanelGroup` —— 左侧 **ChatPanel**(可折叠,默认 35%),右侧 **ArtifactCanvas**。支持 `split` / `columns` 两种布局模式(存 localStorage)。

`ArtifactCanvas` 的标签页:

| 区域 | 标签 | 组件 | 内容 |
|---|---|---|---|
| 主区 | **code** | `center/CodeView.tsx` + `CodeEditor.tsx` | CodeMirror 编辑器,ST 语法高亮,带文件树 |
| 主区 | **logic** | `center/LadderCanvas.tsx` + `LadderRungView.tsx` | 梯形图视图(IR 直接绘制的 SVG rung 卡片),随实时变量着色 |
| 底部 | **process** | `sim/SimRuntime.tsx` | 过程仿真动画 |
| 底部 | **vars** | `right/VariableMonitor.tsx` | 实时变量监控(带变量数 badge) |
| 底部 | **logs** | `layout/BottomLogs.tsx` | 运行时日志 |

## 关键子系统

### ST → 梯形图转换器(`src/transformer/`)

`st-to-ladder.ts` 把 ST 源码经 AST(`ast/`)转换为梯形图中间表示(`ladder-ir/`);当前 UI 由 `LadderRungView` 直接以 SVG 渲染该 IR。完整管线还可继续走布局(`layout/`)→ React Flow 节点(`react-flow/`),`live/` 负责实时值着色;React Flow 自定义节点在 `src/ladder-nodes/`(Contact / Coil / Timer / Counter / Comparator / PowerRail),目前不挂载到界面。

### ST 语言支持(`src/lang/`)

基于 Lezer 的 ST 语法(`st.grammar`),提供 CodeMirror 的语法高亮与自动补全;`st-docs` 提供文档数据,经补全 info 面板呈现(早期的 `st-hover` 悬停提示模块已在语言服务重构中删除)。

### 聊天面板(`src/components/left/`)

`ChatPanel` + `PlanCard` + `blocks/`(ThinkingBlock / ToolCallCard / MarkdownText 等)。`blocks/tools/` 下为每类工具调用定制渲染卡片(Compile / Edit / Force / Read / Shell / Skill / Trace / Vars / Verify …),经 `registry.tsx` 注册分发。

### 过程仿真(`src/components/sim/`)

`SimRuntime.tsx` 消费 `plc_buildSimulation` 生成的 Scene Spec(`scene.json`),用 `parts.tsx` / `partsCatalog.ts` 里的部件(传送带、水箱、电机等)做布局与动画,`resolveEffect.ts` 把实时 PLC 变量值映射为视觉效果。

### 状态管理(`src/store/`)

zustand,按域拆分:`agent` / `editor` / `engine` / `logs` / `model` / `plc` / `sim` / `workspace`(`engine` 存容器引擎可用性,不经 WS 分发,浏览器版停留 `unknown`)。WS 客户端在 `src/ws/client.ts`,启动时连接并把消息分发进各 store。

## 目录速览

```
src/
├── App.tsx  main.tsx  theme.ts
├── components/
│   ├── layout/   TopBar / ArtifactCanvas / BottomLogs / ModelPanel
│   ├── left/     ChatPanel + blocks/(含 tools/ 工具卡片)
│   ├── center/   CodeView / CodeEditor / LadderCanvas / LadderRungView
│   ├── right/    VariableMonitor
│   └── sim/      SimRuntime / parts / partsCatalog / layout / resolveEffect
├── entries/      chat.tsx(VSCode 侧边栏入口,vite 第二构建入口)
├── ladder-nodes/ 梯形图 React Flow 自定义节点
├── transformer/  ST → 梯形图管线
├── lang/         Lezer ST 语法 + CodeMirror 集成
├── models/       PLC 与梯形图数据类型定义
├── store/        zustand stores
├── lib/          工具函数(codeHighlight 等)
├── i18n/         多语言与场景文案
├── styles/       样式
└── ws/           WebSocket 客户端
```
