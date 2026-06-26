import axios, { type AxiosInstance } from 'axios'
import * as https from 'https'
import type { PlcStatus } from '../types.js'

export interface CompilationPollResult {
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT'
  logs: string[]
  gccErrors: string[]
}

export class RuntimeClient {
  private token: string | null = null
  private http: AxiosInstance

  constructor(
    private baseUrl: string,
    private username: string,
    private password: string,
    httpClient?: any,
  ) {
    this.http = httpClient ?? axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 30_000,
    })

    // Retry once on 401 by refreshing the token (only available on real axios instances)
    if (this.http.interceptors) {
      this.http.interceptors.response.use(
        (res: any) => res,
        async (err: any) => {
          if (err.response?.status === 401 && !err.config._retry) {
            this.invalidateToken()
            err.config._retry = true
            const newToken = await this.getToken()
            err.config.headers['Authorization'] = `Bearer ${newToken}`
            return this.http.request(err.config)
          }
          return Promise.reject(err)
        },
      )
    }
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token

    // Ensure user exists (first-run idempotent)
    await this.http.post(
      `${this.baseUrl}/api/create-user`,
      { username: this.username, password: this.password, role: 'admin' },
      { validateStatus: () => true },
    ).catch(() => {})

    const resp = await this.http.post(
      `${this.baseUrl}/api/login`,
      { username: this.username, password: this.password },
      { validateStatus: () => true },
    )
    const token = resp.data?.access_token ?? resp.data?.token
    if (!token) throw new Error('Authentication failed: no token in response')
    this.token = token
    return token
  }

  private async authHeaders() {
    return { Authorization: `Bearer ${await this.getToken()}` }
  }

  async getStatus(): Promise<PlcStatus> {
    const resp = await this.http.get(`${this.baseUrl}/api/status`, {
      headers: await this.authHeaders(),
    })
    // OpenPLC Runtime may return 'STATUS:RUNNING' or 'RUNNING' — normalize to bare form
    const raw: string = resp.data.status ?? ''
    const normalized = raw.startsWith('STATUS:') ? raw.slice('STATUS:'.length) : raw
    return normalized as PlcStatus
  }

  async startPlc(): Promise<string> {
    const resp = await this.http.get(`${this.baseUrl}/api/start-plc`, {
      headers: await this.authHeaders(),
    })
    return resp.data.status ?? ''
  }

  async stopPlc(): Promise<string> {
    const resp = await this.http.get(`${this.baseUrl}/api/stop-plc`, {
      headers: await this.authHeaders(),
    })
    return resp.data.status ?? ''
  }

  async uploadZip(zipBuffer: Buffer, filename: string): Promise<{ ok: boolean; error: string | null }> {
    const { default: FormData } = await import('form-data')
    const form = new FormData()
    form.append('file', zipBuffer, { filename, contentType: 'application/zip' })

    const resp = await this.http.post(`${this.baseUrl}/api/upload-file`, form, {
      headers: { ...(await this.authHeaders()), ...form.getHeaders() },
    })
    const fail = resp.data?.UploadFileFail ?? ''
    return { ok: !fail, error: fail || null }
  }

  async pollCompilationStatus(
    intervalMs = 2000,
    timeoutMs = 55_000,
  ): Promise<CompilationPollResult> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const resp = await this.http.get(`${this.baseUrl}/api/compilation-status`, {
        headers: await this.authHeaders(),
      })
      const { status, logs = [] } = resp.data
      if (status === 'SUCCESS' || status === 'FAILED') {
        return {
          status,
          logs: logs as string[],
          gccErrors: (logs as string[]).filter((l: string) =>
            l.toLowerCase().includes('error') && !l.includes('[INFO]'),
          ),
        }
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
    return { status: 'TIMEOUT', logs: [], gccErrors: [] }
  }

  async getRuntimeLogs(): Promise<string> {
    const resp = await this.http.get(`${this.baseUrl}/api/runtime-logs`, {
      headers: await this.authHeaders(),
    })
    return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)
  }

  /** Expose token for WebSocket auth */
  async getAuthToken(): Promise<string> {
    return this.getToken()
  }

  invalidateToken(): void {
    this.token = null
  }
}
