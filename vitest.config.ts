import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'functions/test/**/*.test.ts',
      'netlify/test/**/*.test.ts',
      'scripts/test/**/*.test.mjs',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'packages/client/src/**/*.ts'],
      exclude: [
        'packages/core/src/types.ts',
        'packages/core/src/index.ts',
        'packages/client/src/index.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
