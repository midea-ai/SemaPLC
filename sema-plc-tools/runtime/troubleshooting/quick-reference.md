# 快速故障排除参考

## 🚀 快速验证命令

```bash
# 1. 基础环境检查
./scripts/quick_verify.sh

# 2. 手动验证核心功能
docker-compose exec openplc-runtime /workspace/scripts/verify_environment.sh

# 3. 手动测试完整构建
docker-compose exec openplc-runtime /workspace/scripts/plc_build.sh /workspace/samples/simple_counter_fixed.st
```

## 🔧 常见问题快速修复

### matiec编译失败
```bash
# 检查库文件链接
docker-compose exec openplc-runtime bash -c "cd /tmp && ln -sf /usr/local/share/matiec/lib lib && iec2c --help"
```

### 容器无法启动
```bash
# 重新构建容器
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### API无法访问
```bash
# 检查容器状态和端口
docker-compose ps
curl -k https://localhost:8443/api/ping
```

## 📋 问题诊断清单

- [ ] 容器是否正常运行？ `docker-compose ps`
- [ ] API是否可达？ `curl -k https://localhost:8443/api/ping`
- [ ] matiec是否可用？ `docker-compose exec openplc-runtime which iec2c`
- [ ] 库文件是否存在？ `docker-compose exec openplc-runtime ls /usr/local/share/matiec/lib/`
- [ ] ST文件语法是否正确？使用`simple_counter_fixed.st`测试

## 🎯 核心解决方案总结

| 问题 | 解决方案 | 验证命令 |
|------|----------|----------|
| 架构不兼容 | 强制使用x86_64 | `docker-compose build --no-cache` |
| 库文件路径 | 添加符号链接 | `ln -sf /usr/local/share/matiec/lib lib` |
| ST语法错误 | 使用VAR_TEMP分离变量 | `iec2c -f -p -i -l simple_counter_fixed.st` |
| 缺失头文件 | 创建c_blocks.h | `cat > c_blocks.h << 'EOF'...` |
| 脚本超时 | 移除-T参数 | `docker-compose exec (without -T)` |

## 📞 获取帮助

1. 查看具体问题文档：`troubleshooting/0X-*.md`
2. 检查日志：`docker-compose logs openplc-runtime`
3. 手动测试：使用上述验证命令逐步排查