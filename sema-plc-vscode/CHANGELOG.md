# 更新日志

## 0.1.0

首个版本。

- **IDE 面板** — `SemaPLC: Open IDE Panel` 打开对话 + 代码 + 梯形图 + 过程仿真的一体面板,server 随面板启停
- **`.st` 语法高亮** — 关键字、类型、标准功能块、时间字面量、`%I/%Q/%M` 地址
- **MCP 工具** — 16 个 `plc_*` 工具自动注册给 Copilot agent mode 等 VS Code MCP 助手,不开面板也能用
- **容器引导** — 自动探测 Docker / Podman,按需启动容器或引导构建镜像;无引擎时给说明页而非错误栈
- **模型 key 管理** — `SemaPLC: Set LLM API Key` 存入 VS Code SecretStorage
