// 抹掉 OpenAI SDK 自带的 UA / x-stainless-* 指纹 header。
//
// 背景sema-core 的 openai 适配器走官方 OpenAI SDK(node_modules/openai),
// 该 SDK 默认带 `User-Agent: OpenAI/JS x.x` 和一堆 `x-stainless-*` header。
// 部分第三方中转站(如 ai.tvt.wiki)的风控会据此识别为官方 SDK 直连,
// 直接返回 403 "Your request was blocked"(在项目里表现为
// "API权限不足 [PERMISSION_DENIED]")。用 curl / 裸 fetch(不带这些 header)
// 请求同一中转站则正常 200。
//
// 解法:在 server 进程启动时全局拦截 fetch,把出站请求的这些指纹 header
// 覆盖/删除掉。只作用于本进程的 LLM 出站请求,不影响本地内部通信。
// 不改 node_modules,重装依赖也不会丢。

const SDK_FINGERPRINT_HEADERS = [
  'x-stainless-retry-count',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-os',
  'x-stainless-arch',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
]

const NEUTRAL_UA = 'curl/8.0'

export function installRelayHeaderFix(): void {
  const originalFetch = globalThis.fetch
  if (!originalFetch) return

  ;(globalThis as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const headers = new Headers(init?.headers ?? (input as Request)?.headers ?? undefined)
      // 仅当目标像是 LLM chat completions 端点时才改写——避免误伤本地 127.0.0.1 请求。
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (/\/chat\/completions(\/|$|\?)/.test(url) || /\/messages(\/|$|\?)/.test(url)) {
        for (const h of SDK_FINGERPRINT_HEADERS) headers.delete(h)
        headers.set('User-Agent', NEUTRAL_UA)
        const newInit = init ? { ...init, headers } : { headers }
        return originalFetch(input, newInit)
      }
    } catch {
      // 改写失败则原样发出,绝不因本拦截器抛错。
    }
    return originalFetch(input, init)
  }
}
