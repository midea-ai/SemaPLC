import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // 集成测试共享同一个真实 OpenPLC runtime,并发跑会互相 stop/start 互搏——必须串行
    fileParallelism: false,
  },
})
