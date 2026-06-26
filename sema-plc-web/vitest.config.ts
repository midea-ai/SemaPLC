import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/frontend/**', 'jsdom'],
      ['tests/**/*.tsx', 'jsdom'],
    ],
    setupFiles: ['tests/setup.ts'],
  },
})
