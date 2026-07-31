import * as os from 'os'
import * as path from 'path'

export interface PlcConfig {
  url: string           // OpenPLC Runtime URL
  container: string     // Docker container name
  checkStdlibDir: string  // rusty StandardFunctions .st dir inside the container
  user: string
  password: string
  stateFile: string     // Path to ~/.plc-tools/state.json
  sceneFile?: string    // PLC_SCENE_FILE — where plc_buildSimulation writes scene.json
  ioMapFile?: string    // PLC_IO_MAP_FILE — optional io_map.yaml of component hints
  workspace?: string    // PLC_WORKSPACE — root for resolving relative stPath
  // When set (PLC_MODBUS_PORT), plc_compile injects conf/modbus_slave.json into the
  // program ZIP so OpenPLC auto-enables the Modbus TCP slave on this port (for FUXA).
  // Unset (default) = off; benchmark/agent flows are unaffected.
  modbusPort?: number | null
  // PLC_POOL_SIZE — verify 工况并行池大小。1(默认)= 串行,走今天的 runVerify;
  // >1 = parallel 分支,工况扇到 #1..#(N-1) 实例(#0 留交互)。实例解析在 verify/pool.ts。
  poolSize: number
  // PLC_DOCKER_BIN — docker 可执行文件替代(podman / colima 等),缺省 'docker'。
  dockerBin: string
}

// PLC_POOL_SIZE → [1, 16] 整数;非法/缺省 → 1(串行)。
function clampPoolSize(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return 1
  return Math.min(16, Math.max(1, n))
}

// Validate the Docker container name against Docker's own allowed charset before
// it ever reaches a `docker exec` argument. Rejecting anything outside
// [a-zA-Z0-9][a-zA-Z0-9_.-]* at the single config entry point cleanses the value
// for every downstream execFile/spawn (defence against Command Injection).
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
function safeContainerName(raw: string | undefined): string {
  const name = raw ?? 'openplc-plc-dev'
  if (!CONTAINER_RE.test(name)) {
    throw new Error(`Invalid PLC_CONTAINER '${name}': must match ${CONTAINER_RE}`)
  }
  return name
}

// 同 safeContainerName 的思路:docker 可执行文件名/路径在进入 execFile 前先过白名单,
// 拒绝 [A-Za-z0-9._/-] 之外的字符(防注入)。
const DOCKER_BIN_RE = /^[A-Za-z0-9._/-]+$/
// 未走 loadConfig 的调用点(compiler.ts / compile.ts 等只拿到 container 字符串)直接用它。
export function dockerBin(): string {
  const bin = process.env.PLC_DOCKER_BIN || 'docker'
  if (!DOCKER_BIN_RE.test(bin)) {
    throw new Error(`Invalid PLC_DOCKER_BIN '${bin}': must match ${DOCKER_BIN_RE}`)
  }
  return bin
}

export function loadConfig(): PlcConfig {
  const rawPort = process.env.PLC_MODBUS_PORT
  const parsedPort = rawPort ? parseInt(rawPort, 10) : NaN
  return {
    url: process.env.PLC_URL ?? 'https://localhost:8443',
    container: safeContainerName(process.env.PLC_CONTAINER),
    checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
    user: process.env.PLC_USER ?? 'admin',
    password: process.env.PLC_PASSWORD ?? 'admin123',
    stateFile: process.env.PLC_STATE_FILE
      ?? path.join(os.homedir(), '.plc-tools', 'state.json'),
    sceneFile: process.env.PLC_SCENE_FILE,
    ioMapFile: process.env.PLC_IO_MAP_FILE,
    workspace: process.env.PLC_WORKSPACE,
    modbusPort: Number.isFinite(parsedPort) ? parsedPort : null,
    poolSize: clampPoolSize(process.env.PLC_POOL_SIZE),
    dockerBin: dockerBin(),
  }
}
