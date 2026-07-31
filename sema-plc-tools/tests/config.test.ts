import { describe, it, expect, afterEach } from 'vitest'
import { dockerBin, loadConfig } from '../src/config.js'

describe('PLC_DOCKER_BIN', () => {
  afterEach(() => { delete process.env.PLC_DOCKER_BIN })

  it('缺省是 docker', () => {
    expect(dockerBin()).toBe('docker')
    expect(loadConfig().dockerBin).toBe('docker')
  })

  it('接受 podman / 绝对路径', () => {
    process.env.PLC_DOCKER_BIN = 'podman'
    expect(dockerBin()).toBe('podman')
    process.env.PLC_DOCKER_BIN = '/usr/local/bin/docker'
    expect(loadConfig().dockerBin).toBe('/usr/local/bin/docker')
  })

  it('拒绝含注入字符的值', () => {
    process.env.PLC_DOCKER_BIN = 'docker; rm -rf /'
    expect(() => dockerBin()).toThrow(/Invalid PLC_DOCKER_BIN/)
  })
})
