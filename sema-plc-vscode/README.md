<div align="center">

<h3>把一句话变成一个跑起来的 PLC 程序</h3>

<p>AI 驱动的 IEC 61131-3 开发环境 —— 对话写码、梯形图实时预览、一键编译上机</p>

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/midea-ai/SemaPLC/blob/main/LICENSE)
[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-blue?style=flat-square)](https://deepwiki.com/midea-ai/SemaPLC)
[![powered by sema-code-core](https://img.shields.io/badge/powered%20by-sema--code--core-blue?style=flat-square)](https://github.com/midea-ai/sema-code-core)
[![OpenPLC Runtime v4](https://img.shields.io/badge/runtime-OpenPLC%20v4-2f7d6f?style=flat-square)](https://openplcproject.com/)

</div>

## 📖 项目概述

**SemaPLC** 是基于 [Sema Code Core](https://github.com/midea-ai/sema-code-core) 引擎的 PLC 编程插件。

用大白话描述控制任务 —— *"按下启动按钮、3 秒定时器到达后锁存电机"* —— Agent 写出 IEC 61131-3 结构化文本,编译、上机、按工况验证行为;编译错和行为不符都由它读结构化报错自己修回去。全程在 `localhost`。

<!-- 截图占位:面板三栏(对话 / 代码+梯形图 / 仿真画面) -->

## ✨ 核心特性

- **自然语言指令** - 描述控制需求,Agent 写出 IEC 61131-3 结构化文本
- **编译-验证-修复闭环** - 编译、上机、按工况验证,失败自动分诊到程序或工况并修回去
- **行为级验证** - 强制输入、采样变量,证明定时器 / 状态机真按需求跑,不止"能编译过"
- **梯形图实时预览** - ST 自动转梯形图,随运行时变量通电着色
- **过程仿真** - 传送带 / 水箱 / 电机动画由实时 PLC 值驱动,可点部件 force
- **MCP 协议支持** - 16 个 `plc_*` 工具注册给 Copilot 等 MCP 助手,不开面板也能用
- **多模型支持** - DeepSeek / Anthropic / OpenAI / Gemini / Qwen / Kimi 等主流 LLM API

## 🚀 上手

扩展视图搜 `SemaPLC` 安装,或从 [Releases](https://github.com/midea-ai/SemaPLC/releases) 下载 VSIX 手动装。然后:

```
1. SemaPLC: Set LLM API Key   填一个模型 key(DeepSeek / Anthropic / OpenAI / Qwen / Kimi …)
2. SemaPLC: Open IDE Panel    或点状态栏的 ⊞ SemaPLC
3. 在对话框里描述控制需求,回车
```

插件复用 VS Code 自带的 Node,**无需另装**。编译上机需要本机有 Docker 或 Podman —— 首次点 **Run** 会提示构建运行时镜像(需网络,约几分钟),之后容器留驻秒开;没有容器引擎也能写码看梯形图,点 Run 会给引导页而非错误栈。也可以把 `semaplc.plcUrl` 指向远程 / 实机的 OpenPLC,本地就不需要容器。

`.st` 文件在编辑器里有语法高亮(关键字、类型、标准功能块、`T#3s`、`%I/%Q/%M` 地址)。

其余命令:`Start / Stop PLC Runtime`、`Rebuild Runtime Image`。设置项见「功能」标签页。

## 📜 License

[MIT](https://github.com/midea-ai/SemaPLC/blob/main/LICENSE)。插件以独立进程调用一套 GPL/LGPL 的 PLC 工具链(matiec、rusty、OpenPLC),各组件许可证见 [THIRD_PARTY_NOTICES.md](https://github.com/midea-ai/SemaPLC/blob/main/THIRD_PARTY_NOTICES.md)。
