import { defineConfig } from 'vitest/config';

/**
 * HTTP + Better Auth + PostgreSQL integration suite.
 *
 * Separate from `vitest.config.ts` (no database at all) and from `vitest.config.db.ts`
 * (schema constraints, through its own client) because this one needs something neither
 * does: `src/lib/prisma.ts` itself repointed at the test database before any module in
 * `src/` is imported. `setupFiles` is the only hook that runs that early, which is what
 * `tests/integration/setup-env.ts` uses.
 *
 * Keeping it out of `npm test` means a green unit run never implies that the real auth
 * integration was exercised.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup-env.ts'],
    globals: false,
    // Every file shares one database and truncates it; parallel files would make failures
    // meaningless.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { LOG_LEVEL: 'fatal' },
  },
});
