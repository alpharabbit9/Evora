// This suite reads DATABASE_URL_TEST straight from the environment and never imports
// src/config/env.ts, so without this nothing loads backend/.env and the suite refused to
// start with "DATABASE_URL_TEST is not set" even when it was set in the file.
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Database handle for the integration suite.
 *
 * It refuses to run against DATABASE_URL. These tests truncate every table, so pointing
 * them at the development database would delete local catalog and order data. The test
 * database must be a separate database created by `prisma migrate deploy`.
 */
function resolveTestUrl(): string {
  const url = process.env.DATABASE_URL_TEST;

  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. These tests need a dedicated PostgreSQL database ' +
        '(see backend/.env.example). They are excluded from `npm test` on purpose.',
    );
  }

  if (url === process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_TEST must not equal DATABASE_URL: this suite truncates every table.',
    );
  }

  return url;
}

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveTestUrl() }),
  log: ['warn', 'error'],
});

/**
 * Tables in dependency order is fragile to maintain, so this discovers them instead and
 * truncates in one statement with CASCADE. `_prisma_migrations` is preserved — dropping it
 * would make the next `migrate deploy` try to replay everything.
 */
export async function truncateAll(): Promise<void> {
  const rows = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (rows.length === 0) {
    throw new Error(
      'The test database has no tables. Run: npm run prisma:deploy with DATABASE_URL pointed at it.',
    );
  }

  const list = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Postgres reports a violated CHECK/unique constraint by name; assertions match on it. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

export async function expectRejection(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const text = errorText(error);
    if (!text.includes(constraintName)) {
      throw new Error(`Expected a violation of "${constraintName}" but got a different error`, {
        cause: error,
      });
    }
    return;
  }

  throw new Error(`Expected "${constraintName}" to reject the write, but it succeeded.`);
}
