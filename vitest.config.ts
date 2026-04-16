import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['tests/**', 'src/**/__mocks__/**'],
    },
  },
});
