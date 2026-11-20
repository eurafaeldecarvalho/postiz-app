import { defineConfig } from 'vitest/config';

// Unit tests only (no database, no network): `pnpm exec vitest run`
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['libraries/**/*.spec.ts', 'apps/backend/**/*.spec.ts'],
  },
});
