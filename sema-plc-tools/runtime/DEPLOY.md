# Runtime 部署指南

OpenPLC Runtime + matiec + xml2st 三件套一体化镜像。

## 架构适配说明

- 容器内固定为 Linux 环境，与宿主机 OS（macOS / Windows / Linux）无关
- 镜像强制 `linux/amd64`（matiec 上游 v4.0.11 的 arm64 release 实际打包的是 x86_64 二进制，见 `Dockerfile.plc-dev` 头部说明）：Apple Silicon 走 Rosetta 2 仿真，Linux ARM 依赖 binfmt + qemu，x86 原生执行
- 用户无需任何手工架构选择

## 文件结构

```
runtime/
├── docker-compose.yml          # 服务编排
├── Dockerfile.plc-dev          # 三件套一体化镜像构建
├── samples/                    # ST 程序样例
│   ├── simple_counter.st       # 故意写坏的样例（供错误路径测试,不可编译）
│   ├── simple_counter_fixed.st # 可编译的计数器样例
│   └── traffic_light.st
└── scripts/
    ├── build-matiec-base.sh    # 构建 MatIEC 基础镜像（部署前置必需）
    ├── verify_environment.sh   # 容器内组件自检（在镜像内执行）
    ├── plc_build.sh            # ST → C → ZIP → 上传 → 编译 完整脚本
    ├── test_api.sh             # REST API 端点测试
    └── quick_verify.sh         # 宿主机一键端到端验证
```

## 快速部署

### 1. 构建基础镜像（首次必需）

`Dockerfile.plc-dev` 的基础镜像 `openplc-runtime-matiec:main` 是本机自建镜像，不在任何 registry 上，新环境必须先构建一次：

```bash
cd sema-plc-tools/runtime
./scripts/build-matiec-base.sh
```

### 2. 启动环境

```bash
docker compose up --build -d
```

构建首次约 3-5 分钟（在基础镜像上叠 matiec/xml2st/rusty）。

### 3. 一键验证

```bash
./scripts/quick_verify.sh
```

该脚本会自动完成：容器启动 → API 鉴权 → 容器内组件自检 → 端到端 ST 编译。

### 4. 单独验证

```bash
# 仅验证容器内组件
docker compose exec openplc-runtime /workspace/scripts/verify_environment.sh

# 仅验证 REST API
./scripts/test_api.sh

# 编译指定 ST 程序
docker compose exec openplc-runtime /workspace/scripts/plc_build.sh \
    /workspace/samples/simple_counter_fixed.st
```

## 验收清单

- [ ] `./scripts/build-matiec-base.sh` 构建出 `openplc-runtime-matiec:main` 基础镜像
- [ ] `docker compose up --build -d` 一次成功
- [ ] 容器健康检查通过（`docker compose ps` 显示 healthy）
- [ ] `iec2c -v` 在容器内可执行
- [ ] `xml2st --help` 在容器内可执行
- [ ] `https://localhost:8443/api/ping` 响应正常
- [ ] `simple_counter_fixed.st` 完成 ST → C → ZIP → 上传 → GCC 编译全链路
- [ ] PLC 可启动运行（`/api/start-plc` 返回 RUNNING）

## 下一步

W1 D3 — 在此环境基础上完成手工全链路验证脚本细化。
