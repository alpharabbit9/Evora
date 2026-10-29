import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

/**
 * One request id per request, echoed in every success/error envelope and in logs
 * (API_SPEC.md §1, architecture.md §13-14). It is minted once here and read back off
 * the response header, so handlers, the error middleware and the logs can never
 * disagree about the value.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Used when the id is read before the middleware ran (e.g. a directly unit-tested handler). */
export const UNKNOWN_REQUEST_ID = 'unknown';

/**
 * A caller-supplied id is accepted so one trace spans frontend -> API, but the value is
 * reflected into responses and log lines, so only an opaque token shape is allowed:
 * anything else (newlines, quotes, control characters) gets a fresh id instead.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Minimal shape needed to read the id back — keeps this usable from tests and fakes. */
interface HeaderReader {
  getHeader(name: string): unknown;
}

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};

export function requestIdOf(res: HeaderReader): string {
  const header = res.getHeader(REQUEST_ID_HEADER);
  return typeof header === 'string' && header.length > 0 ? header : UNKNOWN_REQUEST_ID;
}
