# 架构设计

## 总体结构

```
浏览器 (Vite + React 18, :5173)
  │  /api/* (代理到 :3001)            WebSocket → ws://localhost:3002
  ▼
sema-plc-web 后端 (:3001 HTTP + :3002 WS)
  ├── sema-bridge      内嵌 SemaCore,运行 Agent
  ├── plc-controller   用户触发的 Run / Stop
  └── plc-monitor      实时变量轮询
          │  直接 import
          ▼
sema-plc-tools (dist/)  ──MCP/REST──►  OpenPLC Runtime v4  (Docker, :8443)
   ST → matiec → C → GCC → .so → 执行
```

## 数据流

```mermaid
flowchart LR
    U[用户<br/>自然语言需求] --> C[ChatPanel]
    C -->|WS :3002| B[sema-bridge<br/>内嵌 SemaCore Agent]
    B -->|MCP 工具调用| T[sema-plc-tools]
    T -->|REST/WS :8443| R[OpenPLC Runtime v4<br/>Docker]
    R -->|变量值| M[plc-monitor<br/>500ms 轮询]
    M -->|WS 推送| UI[梯形图 / 变量面板 / 过程仿真]
```

## 关键设计点

**同一套工具,两个消费者。** Agent 基于 `sema-plc-tools` 里的 MCP 工具进行推理;同一套工具(`dist/tools/*`)也被后端 `plc-controller` 直接 import,支撑 IDE 的 Run/Stop 按钮和实时变量面板。工具行为只需实现一次。

**编译管线。** ST 源码经 matiec(iec2c)转成 C,OpenPLC Runtime 内用 GCC 编译成 `.so` 动态加载执行。`plc_compile` 返回带行/列号和出错源码行的结构化错误,便于 Agent 自修复。

**行为验证优先。** 工具链的设计哲学是"证明行为,而非证明编译":`plc_forceVariables` 模拟输入,`plc_trace` 按时间采样验证时序形状,`plc_record` 提供逐扫描周期(20ms/帧)的录制,`plc_verifyBehavior` 把"强制 → 等待下游条件 → 自动释放"做成原子操作。还有声明式的 verify plan(`plc-tools verify plan.json`)跑完整验证用例集。

**端口一览**

| 端口 | 服务 |
|---|---|
| `:5173` | Vite dev server(前端) |
| `:3001` | 后端 HTTP(express,绑定 127.0.0.1) |
| `:3002` | 后端 WebSocket(ws) |
| `:8443` | OpenPLC Runtime REST API(Docker,自签名证书) |

## 各层职责

| 层 | 位置 | 职责 |
|---|---|---|
| 前端 UI | `sema-plc-web/src/` | 聊天、代码编辑(CodeMirror + ST 语法)、梯形图(React Flow)、变量监控、过程仿真 |
| WS 网关 | `sema-plc-web/server/ws-gateway.ts` | JSON-over-WS,对关键状态类型做缓存重放(sticky) |
| sema-bridge | `sema-plc-web/server/sema-bridge.ts` | 内嵌 sema-core,管理会话、工作区、模型注册表 |
| plc-controller | `sema-plc-web/server/plc-controller.ts` | UI 触发的 Run/Stop,直接调用 plc-tools |
| plc-monitor | `sema-plc-web/server/plc-monitor.ts` | 500ms 轮询状态与变量,diff 后推送;按客户端数自动起停 |
| 工具链 | `sema-plc-tools/src/` | 16 个 MCP 工具 + CLI + verify runner |
| 运行时 | `sema-plc-tools/runtime/` | OpenPLC v4 Docker 环境(matiec + rusty) |

详细展开见 [后端架构](wiki/web/backend)、[MCP 工具参考](wiki/tools/mcp-tools) 和 [OpenPLC 运行时环境](wiki/tools/runtime)。
