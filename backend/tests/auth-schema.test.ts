import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getAuthTables } from 'better-auth/db';
import { describe, expect, it } from 'vitest';

import { auth } from '../src/lib/auth.js';

/**
 * Replaces the `better-auth generate` script this package used to declare (its CLI was never
 * installed, so the script could not run). Instead of regenerating the schema, this asserts
 * the committed schema still satisfies what Better Auth asks for at the installed version —
 * which is the property that actually matters, and it runs in CI without a database.
 *
 * If a Better Auth upgrade adds a field, this test names it.
 */
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

/** Better Auth's model key -> the Prisma model the adapter reaches through PrismaClient. */
const PRISMA_MODEL_BY_AUTH_MODEL: Record<string, string> = {
  user: 'User',
  session: 'Session',
  account: 'Account',
  verification: 'Verification',
};

function prismaModelBlock(modelName: string): string {
  const match = new RegExp(`^model ${modelName} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!match?.[1]) throw new Error(`Model ${modelName} is missing from schema.prisma`);
  return match[1];
}

function declaredFields(modelName: string): string[] {
  return prismaModelBlock(modelName)
    .split(/\r?\n/)
    .map((line) => /^\s{2}(\w+)\s+\w/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

const tables = getAuthTables(auth.options);

describe('Better Auth schema requirements', () => {
  it('declares exactly the four identity models Better Auth needs', () => {
    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
  });

  for (const [authModel, table] of Object.entries(tables)) {
    const prismaModel = PRISMA_MODEL_BY_AUTH_MODEL[authModel];

    it(`${authModel}: every required field exists on Prisma model ${prismaModel ?? '(unmapped)'}`, () => {
      expect(prismaModel, `No Prisma model mapped for Better Auth model "${authModel}"`).toBeTypeOf(
        'string',
      );

      const fields = declaredFields(prismaModel as string);
      const missing = Object.entries(table.fields)
        .map(([key, definition]) => definition.fieldName ?? key)
        .filter((fieldName) => !fields.includes(fieldName));

      expect(missing, `Missing on ${prismaModel as string}: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('keeps role and status server-owned so registration cannot self-assign ADMIN', () => {
    expect(tables.user?.fields.role?.input).toBe(false);
    expect(tables.user?.fields.status?.input).toBe(false);
  });

  it('uses role and status defaults that are members of the Prisma enums', () => {
    // Better Auth types these as plain strings while Prisma types them as enums, so the
    // defaults have to agree by convention. This is the check that enforces the convention.
    const roleEnum = /^enum UserRole \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';
    const statusEnum = /^enum UserStatus \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';

    const roleDefault = tables.user?.fields.role?.defaultValue;
    const statusDefault = tables.user?.fields.status?.defaultValue;

    expect(roleDefault).toBeTypeOf('string');
    expect(statusDefault).toBeTypeOf('string');
    expect(roleEnum).toContain(roleDefault as string);
    expect(statusEnum).toContain(statusDefault as string);
  });

  it('cascades sessions and accounts from the user, as Better Auth declares', () => {
    expect(tables.session?.fields.userId?.references?.onDelete).toBe('cascade');
    expect(tables.account?.fields.userId?.references?.onDelete).toBe('cascade');
    expect(prismaModelBlock('Session')).toContain('onDelete: Cascade');
    expect(prismaModelBlock('Account')).toContain('onDelete: Cascade');
  });
});
