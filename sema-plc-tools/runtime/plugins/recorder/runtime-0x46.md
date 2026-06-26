# Runtime 0x46 FETCH_RECORD patch（锚点式编辑说明）

目标文件：容器 `openplc-plc-dev` 内 `/workdir/core/src/plc_app/debug_handler.c`

为逐扫描录波插件（recorder）新增 debug 子功能码 `0x46 MB_FC_DEBUG_FETCH_RECORD`：
插件在加载时通过 `plc_register_record_reader` 注册读回调，宿主在 debug 通道收到
0x46 命令时调用该回调把录波数据写进响应帧。回调注册依赖 plc_main 以 `-rdynamic`
导出函数符号（与插件解析数据符号 `tick__` 同机制，**已实测验证可行**，见文末）。

> 容器内改动是临时的（镜像重建会丢）。正式固化在 Dockerfile（Task 3）做。
> 本文档与 2026-06-10 实际应用并验证通过的编辑逐字一致。

## 幂等性保护（Dockerfile 脚本必读）

Dockerfile `RUN` 层可能被缓存失效后重复执行。若不加判重，patch 脚本会第二次向源文件写入相同内容，导致：

- `#define MB_FC_DEBUG_FETCH_RECORD 0x46` **重定义**编译错；
- switch 内出现 **duplicate case** 编译错。

**脚本开头必须加以下幂等门：**

```bash
FILE=/workdir/core/src/plc_app/debug_handler.c
grep -q 'MB_FC_DEBUG_FETCH_RECORD' "$FILE" && echo "already patched" && exit 0
```

`grep -q` 以 define 名称做子串匹配：该字符串一旦存在（无论是 define 还是 case 行），
视为已打 patch，直接成功退出，不重复写入。

## 现场确认的源码事实（与原计划草稿的差异，已据实校正）

- 响应/命令共用缓冲变量名是 **`data`**（不是 `frame`），来自函数签名
  `size_t process_debug_data(uint8_t *data, size_t length)`。
- 响应长度是**局部变量** `size_t response_len`（不是 `*frame_len` 指针），函数末尾
  `return response_len;`。
- `MAX_DEBUG_FRAME 4096` 在同文件头部已定义，可直接引用。
- 新增差异：case 里加了 `length < 11` 守卫（0x46 命令负载共 11 字节：
  fcode + from_tick u64 + max_slots u16），负载不足按未武装同样返回
  `MB_DEBUG_ERROR_OUT_OF_BOUNDS`，避免读未初始化字节。

## 编辑 1：文件头 define 区

锚点：`#define MB_FC_DEBUG_GET_MD5 0x45` 行**之后**插入。

锚点匹配方式：子串匹配 `MB_FC_DEBUG_GET_MD5`（不做全行精确匹配）。

推荐 sed 命令：

```bash
sed -i '/MB_FC_DEBUG_GET_MD5/a \
\
#define MB_FC_DEBUG_FETCH_RECORD 0x46\
\
/* Recorder plugin read callback. ... */\
typedef size_t (*record_reader_fn)(uint8_t *out, size_t cap,\
                                   uint64_t from_tick, uint16_t max_slots);\
static record_reader_fn g_record_reader = NULL;\
void plc_register_record_reader(record_reader_fn fn) { g_record_reader = fn; }' \
    /workdir/core/src/plc_app/debug_handler.c
```

或用 Python patch 脚本（行内容较长时更可读，见 Task 3 参考实现）。插入内容：

```c
#define MB_FC_DEBUG_FETCH_RECORD 0x46

/* Recorder plugin read callback. The plugin registers it at start_loop via
 * plc_register_record_reader (exported through -rdynamic, same mechanism the
 * plugin uses for tick__). Returns response payload length written to out
 * (excluding the 2-byte [fcode,status] prefix), or 0 if not armed. */
typedef size_t (*record_reader_fn)(uint8_t *out, size_t cap,
                                   uint64_t from_tick, uint16_t max_slots);
static record_reader_fn g_record_reader = NULL;
void plc_register_record_reader(record_reader_fn fn) { g_record_reader = fn; }
```

`plc_register_record_reader` 必须**非 static**，否则不进动态符号表。

## 编辑 2：`process_debug_data` 的 switch(fcode)

**锚点实际行文（已由容器内 grep 核实）：**

```
case MB_FC_DEBUG_GET_MD5:
    debugGetMd5(data, &response_len, endianness_check);
    break;
```

`case` 与 handler 调用是**独立的两行**（不在同一行）。锚点取 `case MB_FC_DEBUG_GET_MD5:`
行做**子串匹配**（不做全行精确匹配），在该行**之前**插入。

推荐 sed 命令：

```bash
sed -i '/case MB_FC_DEBUG_GET_MD5:/i\
    case MB_FC_DEBUG_FETCH_RECORD: {\
        ...\
    }' \
    /workdir/core/src/plc_app/debug_handler.c
```

> **注意**：0x46 的 case 体直接对局部变量 `response_len` 赋值（`response_len = 2 + n`），
> 与其他走 helper 的 case 行为等价——那些 case 把 `&response_len` 当指针传给 helper 写入，
> 结果相同。0x46 是 inline 实现，因此直接赋值即可，无需额外辅助函数。

插入内容：

```c
    case MB_FC_DEBUG_FETCH_RECORD: {
        if (g_record_reader == NULL || length < 11)
        {
            response_len = 2;
            data[0]      = MB_FC_DEBUG_FETCH_RECORD;
            data[1]      = MB_DEBUG_ERROR_OUT_OF_BOUNDS; /* recorder not armed */
            break;
        }
        /* Command payload: data[1..8]=from_tick u64 BE, data[9..10]=max_slots u16 BE.
         * Must be read out before data[0..1] are overwritten with the response. */
        uint64_t from_tick = 0;
        for (int i = 0; i < 8; i++)
        {
            from_tick = (from_tick << 8) | data[1 + i];
        }
        uint16_t max_slots = (uint16_t)data[9] << 8 | (uint16_t)data[10];
        size_t n     = g_record_reader(&data[2], (size_t)MAX_DEBUG_FRAME - 2, from_tick, max_slots);
        data[0]      = MB_FC_DEBUG_FETCH_RECORD;
        data[1]      = MB_DEBUG_SUCCESS;
        response_len = 2 + n;
        break;
    }
```

注意：命令负载（from_tick/max_slots）必须在覆写 `data[0..1]` 之前读出。

## 重建

```bash
docker exec openplc-plc-dev sh -c 'cmake --build /workdir/build --target plc_main 2>&1 | tail -3'
```

产物为 `/workdir/build/plc_main`，即 runtime 实际运行的二进制
（进程 cmdline `./build/plc_main`，cwd `/workdir`）。重建后 `docker restart
openplc-plc-dev` 才会以新二进制运行。

## 验证（2026-06-10 实测记录）

1. 符号导出：

```bash
docker exec openplc-plc-dev sh -c 'nm -D /workdir/build/plc_main | grep plc_register_record_reader'
# 000000000000a040 T plc_register_record_reader
```

2. dlopen 可解析（裁定门，已通过）：10 行探针插件
   `extern void plc_register_record_reader(...)` + `init()` 内注册 dummy 回调，
   编译为 .so 注册进 `/workdir/plugins.conf`（`probe,/tmp/probe.so,1,1,/tmp/probe.json`）
   后重启容器。插件加载器以 `RTLD_LOCAL | RTLD_NOW` dlopen——符号不可解析会当场失败。
   实测日志：

```
[INFO] Native plugin '/tmp/probe.so' symbols loaded successfully
```

   runtime 存活、PLC 正常 RUNNING。**裁定：函数符号经 -rdynamic 可解析，0x46 通道可行。**

3. 插件加载器入口约定（`core/src/drivers/plugin_driver.c`）：`init` 必需，
   `start_loop`/`stop_loop`/`cycle_start`/`cycle_end`/`cleanup` 可选。
