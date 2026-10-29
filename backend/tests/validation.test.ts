import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../src/http/errors.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  idempotencyKey,
  opaqueId,
  pageMeta,
  paginationQuery,
  slug,
  toSkipTake,
} from '../src/http/schemas.js';
import { formatIssuePath, issuesToDetails, parseOrThrow } from '../src/http/validation.js';

describe('formatIssuePath', () => {
  it('reads like a field reference', () => {
    expect(formatIssuePath(['items', 0, 'quantity'], 'body')).toBe('items[0].quantity');
    expect(formatIssuePath(['email'], 'body')).toBe('email');
    expect(formatIssuePath([], 'query')).toBe('query');
  });
});

describe('issuesToDetails', () => {
  it('copies out only the path and the message', () => {
    const result = z
      .object({ email: z.string().email(), age: z.number() })
      .safeParse({ email: 'not-an-email', age: 'forty', password: 'hunter2' });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const details = issuesToDetails(result.error.issues);

    expect(details.map((detail) => detail.field).sort()).toEqual(['age', 'email']);
    expect(JSON.stringify(details)).not.toContain('hunter2');
  });
});

describe('parseOrThrow', () => {
  it('returns the parsed value', () => {
    const parsed = parseOrThrow(z.object({ quantity: z.coerce.number() }), { quantity: '3' });

    expect(parsed).toEqual({ quantity: 3 });
  });

  it('throws the documented validation error', () => {
    try {
      parseOrThrow(z.object({ quantity: z.number() }), { quantity: 'three' }, 'query');
      expect.unreachable('expected parseOrThrow to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as InstanceType<typeof AppError>;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.status).toBe(400);
      expect(appError.details).toEqual([{ field: 'quantity', issue: expect.any(String) }]);
    }
  });
});

describe('pagination', () => {
  it('defaults and caps are applied by the schema, not the caller', () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(paginationQuery.safeParse({ pageSize: MAX_PAGE_SIZE }).success).toBe(true);
    expect(paginationQuery.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(paginationQuery.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationQuery.safeParse({ page: -3 }).success).toBe(false);
  });

  it('derives the offset and the envelope meta', () => {
    const pagination = paginationQuery.parse({ page: '4', pageSize: '25' });

    expect(toSkipTake(pagination)).toEqual({ skip: 75, take: 25 });
    expect(pageMeta(pagination, 108)).toEqual({ page: 4, pageSize: 25, total: 108 });
  });
});

describe('shared field schemas', () => {
  it('accepts the id shapes the project issues and rejects the rest', () => {
    expect(opaqueId.safeParse('ckv9t2x1m0000qzrmn831i7rn').success).toBe(true);
    expect(opaqueId.safeParse('short').success).toBe(false);
    expect(opaqueId.safeParse('../../etc/passwd').success).toBe(false);
    expect(opaqueId.safeParse('1 OR 1=1').success).toBe(false);
  });

  it('accepts lowercase hyphenated slugs only', () => {
    expect(slug.safeParse('wireless-headphones-2').success).toBe(true);
    expect(slug.safeParse('Wireless Headphones').success).toBe(false);
    expect(slug.safeParse('trailing-').success).toBe(false);
  });

  it('requires an idempotency key long enough not to collide', () => {
    expect(idempotencyKey.safeParse('a'.repeat(32)).success).toBe(true);
    expect(idempotencyKey.safeParse('too-short').success).toBe(false);
  });
});
