import express from 'express'
import * as http from 'http'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { configRouter } from './routes/config.js'
import { normalizeRouter } from './routes/normalize.js'
import { checkRouter } from './routes/check.js'
import type { Config } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function createHttpServer(cfg: Config): http.Server {
  const app = express()
  app.use(express.json({ limit: '256kb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', configRouter(cfg))
  app.use('/api', normalizeRouter)
  app.use('/api', checkRouter)

  // Serve built frontend (production); in dev mode Vite handles this on :5173
  const webDist = path.resolve(__dirname, '..', 'web', 'dist')
  app.use(express.static(webDist))

  // Plain HTTP is intentional: this is a localhost developer tool bound to the
  // loopback interface only (see index.ts → listen(port, '127.0.0.1')), so traffic
  // never leaves the machine and TLS is not applicable. Do not expose this port on
  // a public interface; put it behind a reverse proxy that terminates TLS if remote
  // access is ever required.
  return http.createServer(app)
}
