import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
});
