import 'dotenv/config';

/**
 * Runs before anything in `src/` is imported, and points this process's DATABASE_URL at the
 * test database.
 *
 * It has to happen here rather than in a test file: `src/config/env.ts` reads the
 * environment at import time, and `src/lib/prisma.ts` builds its connection pool from that,
 * so by the time a test body runs the client is already bound. Vitest executes setup files
 * ahead of the test module graph, which is the only window where this works.
 *
 * The three refusals below are the reason this is safe. The suite truncates every table, so
 * running it against the development database would delete local catalog and order data.
 */
const devUrl = process.env.DATABASE_URL;
const testUrl = process.env.DATABASE_URL_TEST;

if (!testUrl) {
  throw new Error(
    'DATABASE_URL_TEST is not set. The integration suite needs a dedicated PostgreSQL ' +
      'database (see backend/.env.example). It is excluded from `npm test` on purpose.',
  );
}

if (testUrl === devUrl) {
  throw new Error(
    'DATABASE_URL_TEST must not equal DATABASE_URL: this suite truncates every table.',
  );
}

// Independent of the comparison above, in case DATABASE_URL is unset in some environment.
if (!/test/i.test(new URL(testUrl).pathname)) {
  throw new Error(
    'Refusing to run: DATABASE_URL_TEST does not name a database containing "test". ' +
      'This suite truncates every table.',
  );
}

process.env.DATABASE_URL = testUrl;
