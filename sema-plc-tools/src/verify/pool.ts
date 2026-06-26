// verify 并行实例池(spec 2026-06-16 §5.2)——进程内,不做跨进程锁。
// 池 = #1..#poolSize(专用容器,端口 basePort+id;#0 留交互,不计入池)。
// poolSize===1 走 serial 分支,不调用本模块。
import { RuntimeClient } from '../client/runtime.js'
import type { PlcConfig } from '../config.js'

export interface Instance {
  id: number          // 1..poolSize
  cfg: PlcConfig      // cfg 克隆:url/container 换成本实例
  client: RuntimeClient
}

// 从 cfg.url 解析 host + basePort(尊重 PLC_URL 覆盖),实例端口 = basePort + id。
function deriveBase(url: string): { host: string; basePort: number } {
  const m = url.match(/^(.*):(\d+)$/)
  if (m) return { host: m[1], basePort: parseInt(m[2], 10) }
  return { host: url, basePort: 8443 }
}

/** 第 id 实例的 cfg(url=basePort+id,container=openplc-plc-dev-${id})。 */
export function instanceCfgFor(cfg: PlcConfig, id: number): PlcConfig {
  const { host, basePort } = deriveBase(cfg.url)
  return { ...cfg, url: `${host}:${basePort + id}`, container: `openplc-plc-dev-${id}` }
}

/** 解析池实例 #1..#poolSize。container=openplc-plc-dev-${id},port=basePort+id。 */
export function resolveInstances(cfg: PlcConfig): Instance[] {
  const out: Instance[] = []
  for (let id = 1; id <= cfg.poolSize; id++) {
    const instCfg = instanceCfgFor(cfg, id)
    out.push({ id, cfg: instCfg, client: new RuntimeClient(instCfg.url, instCfg.user, instCfg.password) })
  }
  return out
}

export interface PoolRunOpts<R> {
  now: () => number
  deadline: () => number
  failFast: boolean
  isFailure?: (r: R) => boolean          // failFast 判定:结果算失败 → 跳停取新活
  isHealthy: (inst: Instance) => boolean // 实例不健康(连接错)→ 该 worker 退出
  onFailFast?: () => void
}

/**
 * N 个 worker 各绑一个实例,共享声明序游标消费 items;返回与 items 同序的稀疏结果
 * (未取到 = undefined,即 skipped)。
 * - `const i = cursor++` 在 Node 单线程同步段原子,无丢活/无重复。
 * - failFast 命中后停止取新活,但**等飞行中的 case 自然完成**(不丢弃 → 不泄漏 force)。
 * - poolSize=1 → 单 worker 顺序消费 = 串行。
 */
export async function runWithPool<T, R>(
  instances: Instance[],
  items: T[],
  fn: (item: T, inst: Instance, index: number) => Promise<R>,
  opts: PoolRunOpts<R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined)
  let cursor = 0
  let failFastTripped = false

  const worker = async (inst: Instance): Promise<void> => {
    while (true) {
      if (failFastTripped) break
      if (opts.now() >= opts.deadline()) break
      if (!opts.isHealthy(inst)) break
      const i = cursor++                 // 同步、原子:两个 worker 不会拿到同一个 i
      if (i >= items.length) break
      const r = await fn(items[i], inst, i)
      results[i] = r
      if (opts.failFast && opts.isFailure?.(r)) {
        failFastTripped = true
        opts.onFailFast?.()
      }
    }
  }

  await Promise.all(instances.map(inst => worker(inst)))
  return results
}
