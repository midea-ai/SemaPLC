# 项目概述

**Sema PLC** 把一句自然语言的控制需求变成一个运行中的 PLC 程序。在聊天面板里输入任务 —— *"按下启动按钮且 3 秒定时器到达后锁存电机"* —— 内置的 [sema-core](https://github.com/midea-ai/sema-code-core) Agent 会:

1. 编写 IEC 61131-3 结构化文本(ST)
2. 编译它(matiec:ST → C → GCC → `.so`)
3. 部署到运行中的 [OpenPLC Runtime](https://openplcproject.com/)
4. 做行为验证 —— 强制 `%I` 输入、随时间采样变量,证明定时器 / 状态机 / 计数器确实按需求行为,而不只是"能编译过"
5. 把结果以**梯形图 + 实时变量 + 过程仿真**的形式呈现

## 两个协同工作的包

| 包 | 角色 |
|:--------|:-----|
| **`sema-plc-web`** | Agent 驱动的 IDE。本地 Web 应用(React 18 + Vite 前端,Node 后端),内嵌 sema-core Agent,可视化 ST → 梯形图 + 实时变量 + 过程仿真 + 工具调用日志。 |
| **`sema-plc-tools`** | 支撑 IDE 的 PLC 工具链。既是 Agent 驱动的 **MCP 服务**,也是**独立 CLI**;覆盖完整闭环(语法检查 → 编译 → 上传 → 运行 → 读取 / 强制 / 采样变量),并附带 OpenPLC Runtime 的 Docker 环境。 |

两个包是独立的 npm 包(非 workspace),`sema-plc-web` 直接以相对路径 import `sema-plc-tools` 的 `dist/`。

## 功能特性

| 特性 | 说明 |
|:--------|:------------|
| **自然语言 → 运行中的 PLC** | Agent 端到端地生成、编译、部署并验证 ST 程序。 |
| **实时梯形图** | 生成的 ST 转换为梯形图视图(React Flow),随运行时变量值实时着色。 |
| **行为验证** | 强制输入 + 时序采样,验证真实行为而非仅编译通过。 |
| **过程仿真** | 原生 Scene-Spec 仿真,用实时 PLC 值驱动对象模型(传送带、水箱、电机)动画。 |
| **MCP 服务 + CLI** | 16 个可组合工具,任何支持 MCP 的 agent 可用,也可在终端直接调用。 |
| **OpenPLC Runtime v4** | 真实 IEC 61131-3 执行环境,一条命令启动的 Docker 环境。 |

## 隐私与许可

一切都跑在 `localhost` —— 你的代码和 LLM key 除了你自己配置的模型 API 调用外,不会离开你的机器。

Sema PLC 自身代码以 MIT 许可证发布;它以独立命令行二进制(构建进 Docker 镜像)的方式驱动 GPL/LGPL 的 PLC 工具链(matiec、rusty、OpenPLC),copyleft 不传染到 MIT 源码。详见仓库中的 `THIRD_PARTY_NOTICES.md`。

## 致谢

- 基于 [OpenPLC](https://openplcproject.com/) Runtime v4 + [matiec](https://github.com/nucleron/matiec) IEC 61131-3 编译器构建
- 内嵌的 LLM Agent 运行时是 [sema-code-core](https://github.com/midea-ai/sema-code-core);WebSocket 网关与内嵌 Agent 的模式参考自 [SemaClaw](https://github.com/midea-ai/SemaClaw)
- 梯形图渲染器取自 [cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor)(MIT)
