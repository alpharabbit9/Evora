import { ApiError, ApiErrorCode, type ApiErrorCodeName, type ApiErrorDetail } from './api-error';
import { API_BASE_URL } from './env';

/**
 * The single way this app talks to the CommerceCore API.
 *
 * Every caller would otherwise repeat the same five steps — build the URL, send the
 * session cookie cross-origin, stringify the body, unwrap the `{ data, meta }` envelope,
 * and turn a failure into something catchable. Centralising them means a route cannot
 * accidentally ship without credentials, and the error a component catches is always an
 * `ApiError` (API_SPEC.md §1, ADR 0006).
 *
 * Server Components: `credentials` has no meaning on the server, so forward the incoming
 * cookie explicitly —
 *   `apiGet('/me', { headers: { cookie: (await cookies()).toString() } })`
 * — and never cache the result of a personalised read (architecture.md §10).
 */
export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Prices, totals and roles in here are never authoritative. */
  body?: unknown;
  /** `null`/`undefined` entries are dropped instead of being sent as empty strings. */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Makes a retried mutation safe to replay (API_SPEC.md §6). */
  idempotencyKey?: string;
  /** Defaults to `no-store`: responses here are personalised or price/stock sensitive. */
  cache?: RequestCache;
}

/** Opaque key for a mutation that must not take effect twice. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

function isKnownCode(code: string | undefined): code is ApiErrorCodeName {
  return code !== undefined && code in ApiErrorCode;
}

async function toApiError(response: Response, requestId: string | undefined): Promise<ApiError> {
  const body = (await response.json().catch(() => undefined)) as ErrorEnvelope | undefined;
  const envelope = body?.error;
  const traceId = envelope?.requestId ?? requestId;

  return new ApiError(
    isKnownCode(envelope?.code) ? envelope.code : ApiErrorCode.INTERNAL_ERROR,
    envelope?.message ?? `Request failed with status ${response.status}`,
    {
      status: response.status,
      ...(envelope?.details ? { details: envelope.details } : {}),
      ...(traceId ? { requestId: traceId } : {}),
    },
  );
}

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Sends the request and returns the envelope's `data`, or throws an `ApiError`.
 *
 * `T` is the caller's claim about the response shape; validate it with a schema at the
 * call site wherever the shape actually matters.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const envelope = await fetchEnvelope<T>(path, options);
  return envelope === undefined ? (undefined as T) : envelope.data;
}

/** One page of a collection: the items plus the pagination half of `meta` (API_SPEC.md §1). */
export interface ApiPage<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export async function apiGetPage<T>(
  path: string,
  options: BodylessOptions = {},
): Promise<ApiPage<T>> {
  const envelope = await fetchEnvelope<T[]>(path, { ...options, method: 'GET' });
  const meta = envelope?.meta ?? {};
  const number = (value: unknown): number => (typeof value === 'number' ? value : 0);

  return {
    items: envelope?.data ?? [],
    page: number(meta.page),
    pageSize: number(meta.pageSize),
    total: number(meta.total),
  };
}

/** The whole `{ data, meta }` envelope; `undefined` for a 204. */
async function fetchEnvelope<T>(
  path: string,
  options: ApiRequestOptions,
): Promise<Envelope<T> | undefined> {
  const { method = 'GET', body, query, headers, signal, idempotencyKey, cache } = options;

  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      method,
      // The API sets the session cookie on another origin; without this it is not sent.
      credentials: 'include',
      cache: cache ?? 'no-store',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An abort is the caller's own doing (navigation, a newer keystroke) — let it through
    // so React Query and effects can tell it apart from a real failure.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    throw new ApiError(ApiErrorCode.NETWORK_ERROR, 'The request could not be sent.', { cause });
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (!response.ok) {
    throw await toApiError(response, requestId);
  }

  if (response.status === 204) {
    return undefined;
  }

  try {
    return (await response.json()) as Envelope<T>;
  } catch (cause) {
    throw new ApiError(ApiErrorCode.NETWORK_ERROR, 'The response could not be read.', {
      status: response.status,
      ...(requestId ? { requestId } : {}),
      cause,
    });
  }
}

type BodylessOptions = Omit<ApiRequestOptions, 'method' | 'body'>;
type BodyOptions = Omit<ApiRequestOptions, 'method'>;

export function apiGet<T>(path: string, options: BodylessOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'GET' });
}

export function apiPost<T>(path: string, options: BodyOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'POST' });
}

export function apiPatch<T>(path: string, options: BodyOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'PATCH' });
}

export function apiDelete<T>(path: string, options: BodyOptions = {}): Promise<T> {
  return apiFetch<T>(path, { ...options, method: 'DELETE' });
}
