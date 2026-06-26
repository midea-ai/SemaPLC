import { Router } from 'express'
import type { Config } from '../config.js'

export function configRouter(cfg: Config): Router {
  const r = Router()
  r.get('/config', (_req, res) => {
    res.json({
      workspace: cfg.workspace,
      httpPort: cfg.httpPort,
      wsPort: cfg.wsPort,
      version: '0.2.0',
    })
  })
  return r
}
