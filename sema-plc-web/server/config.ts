import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface Config {
  workspace: string
  httpPort: number
  wsPort: number
  plcContainer: string
  plcToolsDist: string
}

export function loadConfig(argv: string[] = process.argv): Config {
  // CLI arg: --workspace /path
  const wsIdx = argv.indexOf('--workspace')
  const wsArg = wsIdx >= 0 ? argv[wsIdx + 1] : undefined
  const workspace = path.resolve(wsArg ?? process.env.WORKSPACE ?? path.join(os.homedir(), 'plc-workspace'))

  return {
    workspace,
    httpPort: parseInt(process.env.PORT ?? '3001', 10),
    wsPort: parseInt(process.env.WS_PORT ?? '3002', 10),
    plcContainer: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
    plcToolsDist: process.env.PLC_TOOLS_DIST ?? path.resolve(__dirname, '..', '..', 'sema-plc-tools', 'dist'),
  }
}
