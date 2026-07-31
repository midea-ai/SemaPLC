<p align="center">
  <img src="images/semaplc.jpg" alt="Sema PLC logo" width="420" />
</p>

<p align="center">
  <em>Agent 驱动的工业 PLC 编程 IDE —— 用自然语言描述一个控制任务,看着它变成一个运行中的 IEC 61131-3 程序。</em>
</p>

---

## 📖 项目简介

**Sema PLC** 把一句自然语言的控制需求变成一个运行中的 PLC 程序。在聊天面板里输入任务 —— *"按下启动按钮且 3 秒定时器到达后锁存电机"* —— 内置的 [sema-core](https://github.com/midea-ai/sema-code-core) Agent 会编写 IEC 61131-3 结构化文本(ST)、编译它、部署到运行中的 [OpenPLC Runtime](https://openplcproject.com/)、做行为验证(强制输入、采样变量),并把结果以梯形图 + 实时变量 + 过程仿真的形式呈现。

仓库包含两个协同工作的产品:

| 包 | 角色 |
|:--------|:-----|
| **`sema-plc-web`** | Agent 驱动的 IDE。一个本地 Web 应用(React + Vite 前端,Node 后端),内嵌 sema-core Agent,把 ST → 梯形图 + 实时变量 + 过程仿真 + 工具调用日志可视化。 |
| **`sema-plc-tools`** | 支撑 IDE 运行的 PLC 工具链。两种用法 —— 既是 Agent 驱动的 **MCP 服务**,也是可在终端直接运行的**独立 CLI**;覆盖完整闭环(语法检查 → 编译 → 上传 → 运行 → 读取 / 强制 / 采样变量),并附带 OpenPLC Runtime 的 Docker 环境。 |

## ✨ 功能特性

| 特性 | 说明 |
|:--------|:------------|
| **自然语言 → 运行中的 PLC** | 用大白话描述控制逻辑;Agent 端到端地生成、编译、部署并验证 ST 程序。 |
| **实时梯形图** | 生成的 ST 被转换为梯形图视图(React Flow),并随运行时变量值实时着色。 |
| **行为验证** | Agent 强制 `%I` 输入、随时间采样变量,以证明定时器 / 状态机 / 计数器确实按需求行为 —— 不只是"能编译过"。 |
| **过程仿真** | 原生 Scene-Spec 仿真,用一个被实时 PLC 值驱动的对象模型(传送带、水箱、电机)做动画。 |
| **MCP 服务 + CLI** | 16 个可组合工具(`plc_check`、`plc_compile`、`plc_buildAndRun`、`plc_readVariables`、`plc_forceVariables`、`plc_trace` …)。 |
| **OpenPLC Runtime v4** | 经 OpenPLC + matiec 的真实 IEC 61131-3 执行环境,打包为一条命令即可启动的 Docker 环境。 |

## 🏗 架构总览

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

Agent 基于 `sema-plc-tools` 里的 MCP 工具进行推理;同一套工具也支撑着 IDE 的 Run/Stop 按钮和实时变量面板。一切都跑在 `localhost` —— 你的代码和 LLM key 除了你自己配置的模型 API 调用外,不会离开你的机器。

## 🚀 从这里开始

- [快速开始](wiki/getting-started/quick-start) —— 安装、构建、一条命令拉起 IDE
- [架构设计](wiki/overview/architecture) —— 各组件如何协作
- [MCP 工具清单](wiki/tools/mcp-tools) —— 16 个 PLC 工具的完整参考
- [独立 CLI](wiki/tools/cli) —— 不依赖 Agent 直接驱动 OpenPLC
