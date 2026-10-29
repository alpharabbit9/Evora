import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

import { success } from './errors.js';
import { requestIdOf } from './request-context.js';
import { parseOrThrow } from './validation.js';

/**
 * The shared route adapter. A handler wrapped in `route()` only states its input schemas
 * and returns domain data; this module does the four things every endpoint would
 * otherwise repeat by hand:
 *
 *   1. validate body/query/params server-side (API_SPEC.md §1),
 *   2. look up the request id,
 *   3. wrap the result in the documented success envelope with the right status,
 *   4. forward any thrown error to the single error middleware.
 *
 * Note on try/catch: Express 5 already forwards a rejected handler promise to the error
 * middleware, so this wrapper deliberately contains no try/catch and there is no
 * `asyncHandler` in this codebase — adding one would only hide that fact. What routes
 * were repeating is validation + envelope + status, which is what is centralised here.
 *
 * Business rules stay in services: a `route()` config should read as transport only
 * (architecture.md §5).
 */
const ROUTE_RESULT = Symbol('commercecore.route-result');

export interface RouteResult<T> {
  readonly [ROUTE_RESULT]: true;
  readonly data: T;
  readonly status: number;
  readonly meta: Record<string, unknown>;
  readonly hasBody: boolean;
}

function routeResult<T>(
  data: T,
  status: number,
  meta: Record<string, unknown>,
  hasBody: boolean,
): RouteResult<T> {
  return { [ROUTE_RESULT]: true, data, status, meta, hasBody };
}

/** Explicit status and/or extra `meta` for a handler that needs more than `200 + data`. */
export function respond<T>(
  data: T,
  options: { status?: number; meta?: Record<string, unknown> } = {},
): RouteResult<T> {
  return routeResult(data, options.status ?? 200, options.meta ?? {}, true);
}

/** `201` for a newly created resource (API_SPEC.md §2). */
export function created<T>(data: T, meta: Record<string, unknown> = {}): RouteResult<T> {
  return routeResult(data, 201, meta, true);
}

/** `202` for work accepted into a durable queue/outbox rather than completed inline. */
export function accepted<T>(data: T, meta: Record<string, unknown> = {}): RouteResult<T> {
  return routeResult(data, 202, meta, true);
}

/** `204` with no body — the envelope is skipped entirely. */
export function noContent(): RouteResult<undefined> {
  return routeResult(undefined, 204, {}, false);
}

/** Collection envelope: `data` plus `page`/`pageSize`/`total` in `meta` (API_SPEC.md §1). */
export function paged<T>(
  items: readonly T[],
  page: { page: number; pageSize: number; total: number },
): RouteResult<readonly T[]> {
  return routeResult(items, 200, { ...page }, true);
}

function isRouteResult<T>(value: unknown): value is RouteResult<T> {
  return typeof value === 'object' && value !== null && ROUTE_RESULT in value;
}

export interface RouteContext<TBody, TQuery, TParams> {
  /** Validated request body (`undefined` when the route declares no body schema). */
  readonly body: TBody;
  readonly query: TQuery;
  readonly params: TParams;
  readonly requestId: string;
  /** Escape hatches for the few cases that need raw transport (headers, cookies, streams). */
  readonly req: Request;
  readonly res: Response;
}

/** `undefined` where a route declares no schema for that part of the request. */
type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;

export function route<
  TData,
  TBody extends z.ZodType | undefined = undefined,
  TQuery extends z.ZodType | undefined = undefined,
  TParams extends z.ZodType | undefined = undefined,
>(config: {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  /** Default success status; a `RouteResult` returned by the handler overrides it. */
  status?: number;
  handler: (
    ctx: RouteContext<Parsed<TBody>, Parsed<TQuery>, Parsed<TParams>>,
  ) => Promise<TData | RouteResult<TData>> | TData | RouteResult<TData>;
}): RequestHandler {
  return async (req, res) => {
    const ctx: RouteContext<Parsed<TBody>, Parsed<TQuery>, Parsed<TParams>> = {
      body: (config.body
        ? parseOrThrow(config.body, req.body, 'body')
        : undefined) as Parsed<TBody>,
      query: (config.query
        ? parseOrThrow(config.query, req.query, 'query')
        : undefined) as Parsed<TQuery>,
      params: (config.params
        ? parseOrThrow(config.params, req.params, 'params')
        : undefined) as Parsed<TParams>,
      requestId: requestIdOf(res),
      req,
      res,
    };

    const outcome = await config.handler(ctx);

    const result = isRouteResult<TData>(outcome)
      ? outcome
      : routeResult(outcome, config.status ?? 200, {}, true);

    if (!result.hasBody) {
      res.status(result.status).end();
      return;
    }

    res.status(result.status).json(success(result.data, ctx.requestId, result.meta));
  };
}
