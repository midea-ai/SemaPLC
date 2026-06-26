#!/bin/sh
# apply-0x46-patch.sh — 幂等式向 debug_handler.c 注入 MB_FC_DEBUG_FETCH_RECORD (0x46)
#
# 插入内容与 2026-06-10 容器内手工 patch 并编译验证通过的版本逐字一致。
# 任一锚点 grep 不到 → exit 1（哨兵：上游源码漂移在镜像构建期显式失败）。

FILE=/workdir/core/src/plc_app/debug_handler.c

# 幂等门：已打 patch 直接成功退出
grep -q 'MB_FC_DEBUG_FETCH_RECORD' "$FILE" && echo "already patched" && exit 0

# 锚点校验
grep -q 'MB_FC_DEBUG_GET_MD5' "$FILE" || { echo "ERROR: anchor 1 (MB_FC_DEBUG_GET_MD5) not found in $FILE"; exit 1; }
grep -q 'case MB_FC_DEBUG_GET_MD5:' "$FILE" || { echo "ERROR: anchor 2 (case MB_FC_DEBUG_GET_MD5:) not found in $FILE"; exit 1; }

# 用 Python 实现多行插入（比 sed 转义更稳）
python3 - "$FILE" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path, 'r') as f:
    lines = f.readlines()

# ── 插入 1：在 #define MB_FC_DEBUG_GET_MD5 0x45 行之后 ──────────────────────
INSERT1 = """\
#define MB_FC_DEBUG_FETCH_RECORD 0x46

/* Recorder plugin read callback. The plugin registers it at start_loop via
 * plc_register_record_reader (exported through -rdynamic, same mechanism the
 * plugin uses for tick__). Returns response payload length written to out
 * (excluding the 2-byte [fcode,status] prefix), or 0 if not armed. */
typedef size_t (*record_reader_fn)(uint8_t *out, size_t cap,
                                   uint64_t from_tick, uint16_t max_slots);
static record_reader_fn g_record_reader = NULL;
void plc_register_record_reader(record_reader_fn fn) { g_record_reader = fn; }
"""

# ── 插入 2：在 case MB_FC_DEBUG_GET_MD5: 行之前 ────────────────────────────
INSERT2 = """\
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
"""

out = []
for line in lines:
    # 锚点 1：define MB_FC_DEBUG_GET_MD5 之后插入
    out.append(line)
    if 'MB_FC_DEBUG_GET_MD5' in line and line.strip().startswith('#define'):
        out.append(INSERT1)
    # 锚点 2：case MB_FC_DEBUG_GET_MD5: 之前插入
    if 'case MB_FC_DEBUG_GET_MD5:' in line:
        # 将刚刚 append 的这一行替换为：先插 INSERT2 再插原行
        out.pop()
        out.append(INSERT2)
        out.append(line)

with open(path, 'w') as f:
    f.writelines(out)

print("patch applied OK")
PYEOF
