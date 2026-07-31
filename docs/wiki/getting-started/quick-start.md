# 快速开始

## 前置条件

- **Node.js ≥ 18** 和 **npm**
- **Docker**(macOS / Windows 上用 Docker Desktop)—— 用于 OpenPLC Runtime 容器
- 一个 **LLM API key**(推荐 DeepSeek;支持的完整提供商列表见 [模型配置](wiki/getting-started/model-config))

## 安装

```bash
# 1. 克隆
git clone https://github.com/midea-ai/SemaPLC.git
cd SemaPLC

# 2. 构建工具链(web 应用会直接 import 它的 dist/)
cd sema-plc-tools && npm install && npm run build && cd ..

# 3. 构建 OpenPLC 运行时基础镜像(仅首次;需 Docker + 网络)
#    上游 openplc-runtime 的 main 已切到 STruC++,此脚本钉死到 MatIEC-era 提交。
( cd sema-plc-tools/runtime && ./scripts/build-matiec-base.sh )

# 4. 安装 web 应用(sema-core 以 vendor 形式内置于 sema-plc-web/vendor/,经 file: 依赖安装)
cd sema-plc-web && npm install

# 5. 配置你的 LLM key
cp .env.example .env
#   编辑 .env,填入一个 key,例如 DEEPSEEK_API_KEY=sk-...
```

## 运行(一条命令)

`sema-plc-web/dev.sh` 一条命令拉起一切:

```bash
# 在 sema-plc-web/ 目录下
./dev.sh                        # 默认:PLC_MODEL=deepseek
PLC_THINKING=0 ./dev.sh         # deepseek 建议关思考(8192 输出上限易被截断)
PLC_MODEL=minimax-m2.7 ./dev.sh
```

它依次做 5 件事:

1. 检查/拉起 Docker daemon(macOS 下自动 `open -a Docker`,最多等 120s)
2. 幂等启动容器 `openplc-plc-dev`(已跑则跳过,停着则 `docker start`,不存在才 compose up)
3. 重新构建 `sema-plc-tools`
4. 清理 3001/5173 端口上的旧进程
5. source `.env` 后启动 dev server(前端 + 后端)

> 注意:`dev.sh` 默认工作区为 `/tmp/plc-ver-ws`;手动启动时默认为 `~/plc-workspace`(可用 `WORKSPACE` 环境变量或 `--workspace` 覆盖)。

启动成功后你会看到:

```
[SERVER] HTTP ready on http://127.0.0.1:3001
[SERVER] WS ready on ws://127.0.0.1:3002
[SERVER] [plc-tools] MCP server ready
[VITE]   ➜  Local:   http://localhost:5173/
```

打开 **<http://localhost:5173>**,在聊天面板里描述一个控制需求即可。

> 首次运行会构建 OpenPLC Docker 镜像(含从源码构建的 `rusty` 检查器),可能耗时几分钟。容器在 `https://localhost:8443` 暴露 REST API(自签名证书)。

## 手动分步启动

```bash
# 1. 启动 OpenPLC 运行时
( cd sema-plc-tools/runtime && docker compose up -d --build )

# 2. 构建工具链
( cd sema-plc-tools && npm run build )

# 3. 启动 dev server(concurrently:后端 tsx watch + 前端 vite)
( cd sema-plc-web && npm run dev )
```

## 测试

```bash
cd sema-plc-tools && npm test     # 单测,无需 Docker
cd sema-plc-tools && npm run test:integration   # 集成测试,需容器在跑
cd sema-plc-web   && npm test     # 后端:vitest/node,前端:vitest/jsdom
```
