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

/**
 * The suite must never reach a real gateway, whatever a developer's .env says. These point the real
 * SSLCOMMERZ adapter at `scripts/payments/fake-sslcommerz.ts`, on a port only `payments.test.ts`
 * opens. Other files never call the gateway, because placing an order makes no network call.
 */
process.env.SSLCOMMERZ_BASE_URL = 'http://127.0.0.1:4599';
process.env.SSLCOMMERZ_STORE_ID = 'test-store';
process.env.SSLCOMMERZ_STORE_PASSWORD = 'test-store-password';
delete process.env.PAYMENT_CALLBACK_BASE_URL;

/**
 * Nor a real Groq or OpenAI (ADR 0025): a developer's keys in .env would otherwise be spent by the
 * worker tests' index sweep. `assistant.test.ts` installs providers pointed at
 * `scripts/assistant/fake-llm.ts` itself.
 */
for (const key of [
  'GROQ_API_KEY',
  'GROQ_CHAT_MODEL',
  'GROQ_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'OPENAI_BASE_URL',
]) {
  delete process.env[key];
}
