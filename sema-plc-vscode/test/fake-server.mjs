// 假 server:顶替 vendor/server/server.bundle.mjs,只实现 ServerManager 关心的 /api/health。
// MODE=healthy  正常响应 200(启动成功路径)
// MODE=sick     listen 了但 health 永远 500 —— 触发 waitHealthy 超时,用来验证超时进程会被收掉
import * as http from 'http'

const sick = process.env.FAKE_MODE === 'sick'
http
  .createServer((req, res) => {
    if (req.url === '/api/health' && !sick) return res.writeHead(200).end('ok')
    res.writeHead(500).end('nope')
  })
  .listen(Number(process.env.PORT), '127.0.0.1', () => {
    console.log(`[fake-server] pid=${process.pid} port=${process.env.PORT} mode=${sick ? 'sick' : 'healthy'}`)
  })
