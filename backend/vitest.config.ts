import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // tests/db/** and tests/integration/** need a real PostgreSQL and TRUNCATE every table,
    // so neither is part of `npm test`. They run via `npm run test:db` and
    // `npm run test:integration`, whose configs point DATABASE_URL at DATABASE_URL_TEST
    // first. Running them from here would truncate the development database, and a green
    // `npm test` would also wrongly imply the database behaviour had been exercised.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/db/**', 'tests/integration/**'],
    globals: false,
    // Several tests trigger a 500 on purpose; without this the real logger prints the
    // stack traces and buries the actual test output.
    env: { LOG_LEVEL: 'fatal' },
  },
});
