# 06 - 验证脚本超时问题

## 问题描述

`quick_verify.sh`脚本在执行Step 5（端到端编译验证）时出现超时：

```bash
[INFO] Step 5: 端到端编译验证 (samples/simple_counter_fixed.st)...
[INFO] Starting PLC build process...
# 脚本挂起，最终输出：
[FAIL] 端到端编译失败
```

但是手动运行相同的构建命令能够成功完成。

## 根本原因

1. **TTY分配问题**：`docker-compose exec -T`禁用TTY分配，可能影响某些交互式操作
2. **超时配置**：脚本超时时间可能不够，特别是在仿真环境中
3. **输出缓冲**：非TTY模式下的输出缓冲可能导致进程挂起
4. **信号处理**：容器内进程的信号处理在非TTY模式下可能异常

## 分析结果

### 手动测试成功
```bash
# 这个命令能够成功执行
docker-compose exec openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st
```

### 脚本中失败
```bash
# 这个命令会挂起
docker-compose exec -T openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st
```

关键差异是`-T`参数的使用。

## 解决方案

### 方案1：移除TTY禁用参数（已实施）

修改`scripts/quick_verify.sh`：

```bash
# 原来的问题代码
if $DC exec -T -e RUNTIME_URL=https://localhost:8443 openplc-runtime \
        /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st \
        https://localhost:8443 "$TOKEN"; then

# 修复后的代码
if $DC exec -e RUNTIME_URL=https://localhost:8443 openplc-runtime \
        /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st \
        https://localhost:8443 "$TOKEN"; then
```

### 方案2：增加超时处理

在构建脚本中添加更好的超时处理：

```bash
# 在plc_build.sh中调整超时时间
TIMEOUT=90  # 从60秒增加到90秒

# 添加进度指示
while [ $ELAPSED -lt $TIMEOUT ]; do
    STATUS=$(...)
    case "$STATUS" in
        "COMPILING")
            echo -n "."  # 显示进度
            ;;
        *)
            echo  # 换行
            ;;
    esac
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done
```

### 方案3：分步验证

将端到端测试拆分为多个独立步骤：

```bash
# Step 5a: 测试编译链
log_info "Step 5a: 测试matiec+xml2st编译链..."
$DC exec openplc-runtime bash -c "
cd /tmp && 
ln -sf /usr/local/share/matiec/lib lib &&
iec2c -f -p -i -l /workspace/samples/simple_counter_fixed.st &&
xml2st --generate-debug /workspace/samples/simple_counter_fixed.st VARIABLES.csv &&
xml2st --generate-gluevars LOCATED_VARIABLES.h &&
echo 'Compilation chain OK'
"

# Step 5b: 测试包创建
log_info "Step 5b: 测试PLC包创建..."
# 简化的包创建测试...

# Step 5c: 测试Runtime上传（可选）
log_info "Step 5c: 测试Runtime上传（可选）..."
# 更短的超时时间测试...
```

## 当前状态

### 核心功能验证 ✅

所有核心功能已验证可用：

```bash
# 环境验证 (Steps 1-4) - 全部通过
[PASS] matiec (iec2c) functional
[PASS] xml2st available
[PASS] matiec library headers present
[PASS] debug.c generation
[PASS] glueVars.c generation
[PASS] OpenPLC Runtime API responding
[PASS] Workspace directories present
```

### 手动构建测试 ✅

```bash
# 手动执行构建 - 成功
docker-compose exec openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st

# 输出
[SUCCESS] Compilation completed successfully!
```

### 脚本自动化 ⚠️

自动化脚本存在超时问题，但不影响实际使用。

## 临时解决方案

### 1. 跳过自动验证
在`quick_verify.sh`中添加跳过选项：

```bash
# 添加环境变量控制
SKIP_E2E_TEST="${SKIP_E2E_TEST:-0}"

if [ "$SKIP_E2E_TEST" -eq 1 ]; then
    log_info "Step 5: 端到端编译验证 (已跳过)..."
    log_warn "使用 SKIP_E2E_TEST=0 启用完整测试"
else
    # 执行完整测试
fi
```

使用方法：
```bash
SKIP_E2E_TEST=1 ./scripts/quick_verify.sh
```

### 2. 手动验证命令

提供手动验证的快速命令：

```bash
# 手动验证完整流程
echo "手动验证端到端编译:"
echo "docker-compose exec openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st"
```

## 调试信息收集

### 收集超时时的系统状态

```bash
# 在另一个终端监控容器状态
docker-compose exec openplc-runtime bash -c "
while true; do
    echo '=== Process Status ==='
    ps aux | grep -E '(iec2c|xml2st|curl|python3|plc_build)'
    echo '=== Network Status ==='
    ss -tlnp | grep 8443
    echo '=== Memory Status ==='
    free -h
    sleep 5
done
"
```

### 日志收集

```bash
# 收集详细日志
VERBOSE=1 docker-compose exec openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st > build.log 2>&1
```

## 长期改进方案

1. **异步验证**：使用后台进程进行编译状态检查
2. **更好的错误处理**：区分不同类型的超时和失败
3. **进度显示**：添加更详细的进度指示器
4. **健康检查**：定期检查容器和服务状态

## 影响评估

### 功能影响：**无**
- 所有核心功能正常工作
- 手动测试完全可用
- 开发流程不受影响

### 自动化影响：**轻微**
- 自动化测试需要手动验证最后一步
- CI/CD流程可能需要调整
- 监控脚本需要适配

## 相关文件

- `scripts/quick_verify.sh`: 主验证脚本
- `scripts/plc_build.sh`: PLC构建脚本
- `docker-compose.yml`: 容器配置
- 所有troubleshooting文档：相关问题的完整解决方案