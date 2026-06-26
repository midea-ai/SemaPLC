// The MCP client (sema-core, via @modelcontextprotocol/sdk) times out a tool
// request at ~60s (SDK default). Any plc-tools tool whose duration is caller-
// controlled (waitFor/trace) or runtime-bound (GCC poll) must stay under that,
// or the client throws -32001 while the tool is still running. 50s leaves 10s
// of headroom for transport + the tool's own teardown.
export const MCP_SAFE_MAX_MS = 50_000

export function clampToMcpBudget(ms: number | undefined, fallback: number): number {
  return Math.min(ms ?? fallback, MCP_SAFE_MAX_MS)
}
