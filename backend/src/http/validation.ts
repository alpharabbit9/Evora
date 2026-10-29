import type { z } from 'zod';

import { type AppError, type ErrorDetail, validationFailed } from './errors.js';

/**
 * One place where an untrusted value becomes a typed one. Every route, service and job
 * that accepts outside input goes through `parseOrThrow`, so a rejection always produces
 * the documented `VALIDATION_ERROR` envelope with per-field details (API_SPEC.md §1)
 * instead of a 500 or a hand-written error body.
 *
 * Client-side validation is UX only; this is the boundary that actually protects the
 * domain (CLAUDE.md engineering rules).
 */
type ZodIssue = z.ZodError['issues'][number];

/** `items[0].quantity` reads better in an error body than `["items",0,"quantity"]`. */
export function formatIssuePath(path: readonly PropertyKey[], rootField: string): string {
  let formatted = '';

  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
      continue;
    }

    const name = typeof segment === 'string' ? segment : String(segment);
    formatted += formatted.length === 0 ? name : `.${name}`;
  }

  return formatted.length > 0 ? formatted : rootField;
}

/**
 * Zod issues carry the received value in some cases; only the path and message are
 * copied out, so a rejected payload cannot echo secrets back to the caller or the logs.
 */
export function issuesToDetails(issues: readonly ZodIssue[], rootField = 'body'): ErrorDetail[] {
  return issues.map((issue) => ({
    field: formatIssuePath(issue.path, rootField),
    issue: issue.message,
  }));
}

export function appErrorFromZod(error: z.ZodError, rootField = 'body'): AppError {
  return validationFailed(issuesToDetails(error.issues, rootField));
}

/**
 * Validates `value` or throws the documented validation error.
 *
 * `rootField` names the source being validated ('body', 'query', 'params', ...) and is
 * used for issues that belong to the value as a whole rather than to one field.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  rootField = 'body',
): z.output<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw appErrorFromZod(result.error, rootField);
  }

  return result.data;
}
