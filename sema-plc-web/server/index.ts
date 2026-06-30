// 必须最先执行:抹掉 OpenAI SDK 的 UA/x-stainless 指纹,否则第三方中转站会 403。
// 详见 relay-fetch-fix.ts。
import { installRelayHeaderFix } from './relay-fetch-fix.js'
installRelayHeaderFix()

import { loadConfig } from './config.js'
import { createHttpServer } from './http-server.js'
import { WsGateway } from './ws-gateway.js'
import { SemaBridge } from './sema-bridge.js'
import { PlcMonitor } from './plc-monitor.js'
import { PlcController } from './plc-controller.js'

const cfg = loadConfig()
console.log(`[plc-vis-web] workspace = ${cfg.workspace}`)
console.log(`[plc-vis-web] http :${cfg.httpPort}, ws :${cfg.wsPort}`)

const httpServer = createHttpServer(cfg)
const plcMonitor = new PlcMonitor({ workspace: cfg.workspace })
const plcController = new PlcController({ workspace: cfg.workspace, monitor: plcMonitor })

const wsGateway = new WsGateway({
  port: cfg.wsPort,
  onConnect: () => plcMonitor.clientConnected(),
  onDisconnect: () => plcMonitor.clientDisconnected(),
})

const semaBridge = new SemaBridge(cfg.workspace)
semaBridge.start().catch((e) => {
  console.error('[plc-vis-web] failed to start sema-bridge:', e)
  process.exit(1)
})

httpServer.listen(cfg.httpPort, '127.0.0.1', () => {
  console.log(`[plc-vis-web] HTTP ready on http://127.0.0.1:${cfg.httpPort}`)
  console.log(`[plc-vis-web] WS ready on ws://127.0.0.1:${cfg.wsPort}`)
})

process.on('SIGINT', async () => {
  console.log('\n[plc-vis-web] shutting down...')
  wsGateway.close()
  plcMonitor.stopPolling()
  await semaBridge.dispose()
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 3000)
})
