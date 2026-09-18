import { defineConfig } from 'vitest/config'

// Vitest 4 removed `environmentMatchGlobs`; per-environment selection now
// goes through `projects`: jsdom for DOM-touching suites, node for the rest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'frontend',
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
          include: ['tests/frontend/**/*.test.{ts,tsx}', 'tests/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/frontend/**', 'tests/**/*.test.tsx'],
        },
      },
    ],
  },
})
