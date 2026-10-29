import { defineConfig } from 'vitest/config';

/**
 * Integration suite: runs against a real PostgreSQL at DATABASE_URL_TEST and truncates
 * tables between files, so it is kept out of `npm test` (see vitest.config.ts).
 *
 * `fileParallelism: false` because every file shares one database; parallel truncation
 * would make failures meaningless.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 30_000,
    env: { LOG_LEVEL: 'fatal' },
  },
});
