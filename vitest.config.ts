import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'functions/test/**/*.test.ts',
      'netlify/test/**/*.test.ts',
      'scripts/test/**/*.test.mjs',
      'scripts/test/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // brandColours.ts is the app's contrast model, which the iOS build plan holds to full
      // coverage beside core's and the client's rules.
      include: [
        'packages/core/src/**/*.ts',
        'packages/client/src/**/*.ts',
        'packages/mobile/src/brandColours.ts',
      ],
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
