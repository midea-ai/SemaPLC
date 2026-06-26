/*
 * recorder.c — per-scan flight-recorder plugin for OpenPLC Runtime v4.
 *
 * Productized from the validated spike (W1-D1-D2/recorder-spike/recorder.c).
 * Data path: the TCP text server of the spike is replaced by the debug-channel
 * subfunction 0x46 (MB_FC_DEBUG_FETCH_RECORD) — the runtime's debug_handler.c
 * is patched to export plc_register_record_reader() (see runtime-0x46.md;
 * nm -D /workdir/build/plc_main shows it as a T symbol, dlopen-resolvable).
 *
 * Constraints inherited from the spike (all empirically verified):
 * - init() runs before symbols_init(): get_var_count()==0 there → lazy init
 *   on first cycle_end.
 * - get_var_addr (via get_var_list) is FORCE-AWARE for located vars: the
 *   address flips between ->value and ->fvalue with FORCE_FLAG, so addresses
 *   must be re-queried EVERY cycle, never cached across cycles.
 * - STRING vars: generated get_var_size() returns 0 (no case in the switch) —
 *   skipped; the skipped count is reported in the 0x46 INFO header.
 * - tick__ is a 64-bit unsigned long exported via -rdynamic; cycle_end runs
 *   after ext_config_run__(tick__++), so the just-executed scan is tick__-1.
 * - start_loop()/stop_loop() must be idempotent (driver calls start on every
 *   program (re)load without checking running state).
 *
 * Concurrency: cycle_end (scan thread) is the ONLY writer; record_read runs
 * on the debug/websocket thread. A seqlock replaces the spike's mutex so the
 * scan thread never blocks: write = seq++(odd) → write frame → seq++(even);
 * read = read seq(even) → copy frame → re-read seq, retry if changed/odd.
 *
 * Wire layout below is a FROZEN CONTRACT with the plc-tools parser (BE):
 *   kind=0x01 INFO (max_slots==0):
 *     u8 kind | u32 magic | u16 ver | u16 var_count | u16 skipped
 *     | u16 decimation | u32 slot_size | u32 frames | u32 count | char md5[32]
 *     | var_count x { u16 idx | u32 off | u16 size }
 *   kind=0x02 FRAMES:
 *     u8 kind | u16 n | u64 next_from (0 = no more) | n x { u64 tick | slot }
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <unistd.h>
#include "plugin_types.h"

extern unsigned long tick__;   /* plc_main is linked -rdynamic; resolved at dlopen */

/* md5 program-hash sourcing (shared contract with the plc-tools 0x46 parser):
 * the recorded program's md5 is read from plc_main's -rdynamic pointer
 * ext_plc_program_md5; NULL or <32 chars is padded with '?' (parser treats
 * '?' as "unverifiable"). Forensic detail below in Chinese.
 *
 * md5 符号核实结果（2026-06-11 容器实测）：
 * - 程序 .so（/workdir/build/libplc_*.so）导出的是数据符号:
 *     nm -D → "0000000000006180 D plc_program_md5"（char 数组,NUL 结尾 hex 串）。
 * - 但程序 .so 由 plcapp_manager.c:89 以 dlopen(path, RTLD_NOW)（默认 RTLD_LOCAL）
 *   加载 → 其符号对本插件不可见，不能直接 extern plc_program_md5。
 * - fallback 路径可用：plc_main 自身（-rdynamic）导出
 *     nm -D plc_main → "0000000000210428 B ext_plc_program_md5"（char *，
 *   定义于 core/src/plc_app/utils/utils.c，程序加载时由 image_tables.c 指向
 *   程序 .so 内的 md5 串，未加载/卸载时为 NULL）。
 * - 因此这里 extern 该指针（与 tick__ 同解析机制）；为 NULL 或串短于 32 字节时
 *   不足部分以 '?' 填充（plc-tools Task 6 的 md5 门把 '?' 视为"不可验证"）。 */
extern char *ext_plc_program_md5;

/* 0x46 回调注册（runtime debug_handler.c 已 patch 导出，Task 1 实证 T 符号可解析） */
typedef size_t (*record_reader_fn)(uint8_t *out, size_t cap, uint64_t from_tick, uint16_t max_slots);
extern void plc_register_record_reader(record_reader_fn fn);

#define REC_MAGIC      0x52454331u     /* "REC1" */
#define REC_VER        1
#define MAX_FRAMES     4000
#define MAX_RING_BYTES (16u * 1024 * 1024)

/* seqlock: cycle_end 是唯一写者。写: seq++(odd)→写→seq++(even)。
 * 读: 读 seq(偶)→拷贝→再读相同则一致,否则重试。 */
static volatile uint32_t g_seq = 0;
static uint16_t g_decimation = 1;      /* >1 = 内存超限降级抽稀 */

static plugin_runtime_args_t *g_args = NULL;
static volatile int g_running = 0;     /* start_loop..stop_loop window      */
static volatile int g_inited = 0;      /* lazy var-table + ring ready       */
static volatile int g_disabled = 0;   /* permanent refusal latch (over-wide frame); cleared on re-arm */

/* recorded-variable table (vars with size>0).
 * get_var_count() returns uint16_t, so g_nrec/g_idx ≤ 65535 — the narrowing
 * casts to u16 in the INFO header below are lossless. */
static size_t g_nrec = 0;
static size_t g_skipped = 0;           /* STRING etc. — unrecordable        */
static size_t *g_idx = NULL, *g_size = NULL, *g_off = NULL;
static void **g_addr = NULL;           /* refreshed every cycle             */
static size_t g_slot = 0;              /* payload bytes per frame           */
static size_t g_frame_sz = 0;          /* 8 (tick) + g_slot                 */
static size_t g_frames = 0;

/* ring */
static uint8_t *g_ring = NULL;
static volatile size_t g_head = 0, g_count = 0;

/* reader-presence counter: record_read (debug thread) increments on entry,
 * decrements on every exit path; stop_loop spins on it before free_tables(). */
static volatile int g_readers = 0;

int init(void *args)
{
    g_args = (plugin_runtime_args_t *)args;
    if (!g_args) return -1;
    g_args->log_info("[recorder] init (var table deferred — symbols not loaded yet)");
    return 0;
}

static void free_tables(void)
{
    free(g_idx); free(g_size); free(g_off); free(g_addr); free(g_ring);
    g_idx = g_size = g_off = NULL; g_addr = NULL; g_ring = NULL;
    g_nrec = g_skipped = g_slot = g_frame_sz = g_frames = 0;
    g_head = g_count = 0;
    g_decimation = 1;
}

/* First cycle_end after program load: build the recorded-var table + ring. */
static int lazy_init(void)
{
    uint16_t n = g_args->get_var_count();
    if (n == 0) return 0;                  /* program symbols not ready yet */

    g_idx  = malloc(n * sizeof(size_t));
    g_size = malloc(n * sizeof(size_t));
    g_off  = malloc(n * sizeof(size_t));
    g_addr = malloc(n * sizeof(void *));
    if (!g_idx || !g_size || !g_off || !g_addr) { free_tables(); return 0; }

    size_t off = 0, k = 0, skipped = 0;
    for (size_t i = 0; i < n; i++) {
        size_t s = g_args->get_var_size(i);
        if (s == 0) { skipped++; continue; }   /* STRING etc. — unrecordable */
        g_idx[k] = i; g_size[k] = s; g_off[k] = off;
        off += s; k++;
    }
    g_nrec = k; g_skipped = skipped; g_slot = off; g_frame_sz = 8 + g_slot;

    /* Ring sizing: shrink frame count toward the 64-frame floor to stay under
     * MAX_RING_BYTES. decimation only stretches TIME coverage (1 frame per N
     * ticks); it does NOT shrink memory. The memory ceiling is enforced by the
     * 64-frame floor × frame width — if even 64 frames overflow (a single frame
     * wider than MAX_RING_BYTES/64 = 256KB), we refuse to arm rather than
     * over-allocate. */
    g_frames = MAX_FRAMES;
    g_decimation = 1;
    while (g_frames > 64 && g_frames * g_frame_sz > MAX_RING_BYTES) g_frames /= 2;
    if (64 * g_frame_sz > MAX_RING_BYTES) {
        g_args->log_error("[recorder] frame too wide (%zuB) — recording disabled for this program", g_frame_sz);
        g_disabled = 1;
        free_tables();
        return 0;
    }
    if (g_frames * g_frame_sz > MAX_RING_BYTES) {
        g_decimation = (uint16_t)((g_frame_sz * 64 + MAX_RING_BYTES - 1) / MAX_RING_BYTES);
        g_args->log_warn("[recorder] slot=%zuB too wide — decimation=%u (1 frame per %u ticks)",
                         g_slot, g_decimation, g_decimation);
    }
    g_ring = malloc(g_frames * g_frame_sz);
    if (!g_ring) { free_tables(); return 0; }

    g_head = g_count = 0;
    g_args->log_info("[recorder] armed: vars=%u recorded=%zu skipped=%zu slot=%zuB frames=%zu ring=%zuKB decimation=%u",
                     (unsigned)n, g_nrec, g_skipped, g_slot, g_frames,
                     g_frames * g_frame_sz / 1024, g_decimation);
    return 1;
}

void cycle_end(void)
{
    if (!g_running || !g_args || g_disabled) return;
    if (!g_inited) { if (!lazy_init()) return; g_inited = 1; }

    uint64_t t = (uint64_t)tick__ - 1;     /* the scan that just executed */
    if (g_decimation > 1 && (t % g_decimation) != 0) return;

    /* Re-query addresses every cycle: located vars' address is force-aware. */
    g_args->get_var_list(g_nrec, g_idx, g_addr);

    g_seq++;
    __sync_synchronize();
    uint8_t *f = g_ring + g_head * g_frame_sz;
    memcpy(f, &t, 8);
    for (size_t i = 0; i < g_nrec; i++)
        if (g_addr[i]) memcpy(f + 8 + g_off[i], g_addr[i], g_size[i]);
    g_head = (g_head + 1) % g_frames;
    if (g_count < g_frames) g_count++;
    __sync_synchronize();
    g_seq++;
}

/* ── 0x46 read callback (debug thread) — wire layout is a frozen contract ── */

static void put_u16(uint8_t **p, uint16_t v) { *(*p)++ = v >> 8; *(*p)++ = v; }
static void put_u32(uint8_t **p, uint32_t v) { for (int i = 3; i >= 0; i--) *(*p)++ = v >> (8*i); }
static void put_u64(uint8_t **p, uint64_t v) { for (int i = 7; i >= 0; i--) *(*p)++ = v >> (8*i); }

static size_t do_record_read(uint8_t *out, size_t cap, uint64_t from_tick, uint16_t max_slots)
{
    uint8_t *p = out;

    if (max_slots == 0) {
        size_t need = 1 + 4+2+2+2+2 + 4+4+4 + 32 + g_nrec * 8;
        if (need > cap) return 0;
        *p++ = 0x01;
        put_u32(&p, REC_MAGIC); put_u16(&p, REC_VER);
        put_u16(&p, (uint16_t)g_nrec); put_u16(&p, (uint16_t)g_skipped);
        put_u16(&p, g_decimation);
        put_u32(&p, (uint32_t)g_slot); put_u32(&p, (uint32_t)g_frames);
        put_u32(&p, (uint32_t)g_count);
        /* md5: ext_plc_program_md5 (见文件头核实注释); 不可得则 '?' 填充 */
        {
            const char *m = ext_plc_program_md5;
            size_t i = 0;
            if (m) for (; i < 32 && m[i]; i++) p[i] = (uint8_t)m[i];
            for (; i < 32; i++) p[i] = '?';
            p += 32;
        }
        for (size_t i = 0; i < g_nrec; i++) {
            put_u16(&p, (uint16_t)g_idx[i]); put_u32(&p, (uint32_t)g_off[i]); put_u16(&p, (uint16_t)g_size[i]);
        }
        return (size_t)(p - out);
    }

    *p++ = 0x02;
    uint8_t *n_pos = p; put_u16(&p, 0);
    uint8_t *next_pos = p; put_u64(&p, 0);
    uint16_t n = 0;
    uint64_t next_from = 0;

    /* Frame-selection snapshot: read head/count once under a stable seq so the
     * start/count used to walk the ring is self-consistent. Per-frame content
     * is still re-validated by its own seqlock retry below — after this snapshot
     * the writer may overwrite the oldest frame(s); the retry catches that and
     * the selection itself stays coherent against the snapshot. */
    size_t snap_head, snap_count;
    {
        uint32_t s0, s1;
        do {
            s0 = g_seq; __sync_synchronize();
            if (s0 & 1) continue;
            snap_head = g_head; snap_count = g_count;
            __sync_synchronize(); s1 = g_seq;
        } while (s0 != s1 || (s0 & 1));
    }

    for (size_t i = 0; i < snap_count && n < max_slots; i++) {
        uint8_t tmp[8 + 4096];
        if (g_frame_sz > sizeof(tmp)) break;      /* 超宽帧只支持 INFO */
        uint32_t s0, s1 = 0;
        do {
            s0 = g_seq; __sync_synchronize();
            if (s0 & 1) continue;
            size_t start = (snap_head + g_frames - snap_count) % g_frames;
            size_t pos = (start + i) % g_frames;
            memcpy(tmp, g_ring + pos * g_frame_sz, g_frame_sz);
            __sync_synchronize(); s1 = g_seq;
        } while (s0 != s1 || (s0 & 1));
        uint64_t t; memcpy(&t, tmp, 8);
        if (t < from_tick) continue;
        if ((size_t)(p - out) + 8 + g_slot > cap) { next_from = t; break; }
        put_u64(&p, t);
        memcpy(p, tmp + 8, g_slot); p += g_slot;
        n++;
    }
    n_pos[0] = (uint8_t)(n >> 8); n_pos[1] = (uint8_t)n;
    for (int i = 7; i >= 0; i--) next_pos[7 - i] = (uint8_t)(next_from >> (8*i));
    return (size_t)(p - out);
}

/* Thin reader-counted wrapper: single entry/exit so g_readers is always
 * balanced. stop_loop spins on g_readers before free_tables() — this closes the
 * deregister→free use-after-free window against the debug thread. */
static size_t record_read(uint8_t *out, size_t cap, uint64_t from_tick, uint16_t max_slots)
{
    __sync_fetch_and_add(&g_readers, 1);
    size_t ret = g_inited ? do_record_read(out, cap, from_tick, max_slots) : 0;
    __sync_fetch_and_sub(&g_readers, 1);
    return ret;
}

/* 驱动约定（plugin_driver.h 实测）：typedef int (*plugin_start_loop_func_t)(void),
 * 返回非 0 视为启动失败（spike 的 void 版本靠 pthread_create 残留 0 侥幸通过）。 */
int start_loop(void)
{
    if (g_running) return 0;               /* idempotent: driver may re-call */
    g_running = 1;
    g_inited = 0;                          /* program may have changed → re-arm */
    g_disabled = 0;
    free_tables();
    plc_register_record_reader(record_read);
    return 0;
}

void stop_loop(void)
{
    if (!g_running) return;
    g_running = 0;
    plc_register_record_reader(0);     /* no new readers can enter via the callback */
    g_inited = 0;
    __sync_synchronize();

    /* Drain any reader already inside record_read (it entered via the old
     * pointer before deregistration). Wait silently up to ~2s; on timeout,
     * skip free_tables() — leaking the ring is safer than freeing under a
     * live reader (UAF would crash the in-process PLC). */
    int spun = 0;
    while (g_readers > 0) {
        if (spun++ >= 2000) {
            if (g_args && g_args->log_error)
                g_args->log_error("[recorder] reader drain timed out — leaking ring to avoid UAF");
            return;
        }
        usleep(1000);
    }
    free_tables();
}

void cleanup(void)
{
    stop_loop();
}

/* ABI 哨兵：容器内 plugin_types.h 实测字段顺序 get_var_list < get_var_size <
 * get_var_count。布局变动会让 recorder 经函数指针读到错误成员——编译期拦截。 */
_Static_assert(offsetof(plugin_runtime_args_t, get_var_count) >
               offsetof(plugin_runtime_args_t, get_var_list),
               "plugin_runtime_args_t layout changed — re-verify recorder field access");
