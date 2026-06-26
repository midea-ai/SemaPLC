# 01 - Docker架构兼容性问题

## 问题描述

在Apple Silicon (ARM64)宿主机上运行OpenPLC开发环境时，matiec编译器出现崩溃：

```
/workspace/scripts/verify_environment.sh: line 67: 1455 Trace/breakpoint trap iec2c -f -p -i -l simple_test.st > /dev/null 2>&1
```

同时出现Rosetta仿真错误：
```
rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2
```

## 根本原因

1. **架构不匹配**：容器运行在ARM64架构上，但matiec二进制文件是x86_64格式
2. **上游发布问题**：matiec v4.0.11的linux-arm64 release实际包含的是x86_64二进制文件（命名错误）
3. **仿真失败**：Rosetta 2无法正确处理该二进制文件

## 验证方法

```bash
# 检查容器架构
docker-compose exec openplc-runtime uname -m

# 检查二进制文件架构
docker-compose exec openplc-runtime file /usr/local/bin/iec2c
```

## 解决方案

### 方案1：强制使用x86_64架构（当前采用）

修改 `Dockerfile.plc-dev`:

```dockerfile
# 强制使用linux/amd64平台
FROM --platform=linux/amd64 ghcr.io/autonomy-logic/openplc-runtime:latest
```

**优点**：
- 确保所有组件架构一致
- 避免混合架构问题
- Apple Silicon通过Docker Desktop自动使用Rosetta 2仿真

**缺点**：
- 在ARM64主机上性能稍差（仿真开销）
- 依赖Rosetta 2或qemu-user-static

### 方案2：等待上游修复（长期方案）

等待matiec项目修复ARM64 release的架构问题，然后恢复动态架构选择：

```dockerfile
ARG TARGETARCH
FROM ghcr.io/autonomy-logic/openplc-runtime:latest

# 根据TARGETARCH选择对应的matiec release
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        MATIEC_ARCH="linux-arm64"; \
    else \
        MATIEC_ARCH="linux-x64"; \
    fi
```

## 影响范围

- **阻塞性影响**：无法进行任何ST程序编译
- **影响组件**：matiec (iec2c), iec2iec
- **影响平台**：主要是Apple Silicon Mac，部分ARM64 Linux服务器

## 测试验证

```bash
# 验证修复效果
docker-compose build --no-cache
docker-compose up -d
docker-compose exec openplc-runtime /workspace/scripts/verify_environment.sh
```

期望输出：
```
[PASS] matiec (iec2c) functional
```

## 相关文件

- `Dockerfile.plc-dev`: Docker镜像定义
- `scripts/verify_environment.sh`: 环境验证脚本
- `docker-compose.yml`: 容器编排配置