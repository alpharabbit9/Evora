import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { conflict, notFound } from '../src/http/errors.js';
import { errorHandler, notFoundHandler } from '../src/http/error-handler.js';
import { requestContext } from '../src/http/request-context.js';
import { accepted, created, noContent, paged, respond, route } from '../src/http/route.js';
import { idParams, paginationQuery, sortQuery, toSkipTake } from '../src/http/schemas.js';

/** The real middleware stack a route sits in, without the auth/database wiring. */
function testApp(mount: (app: Express) => void): Express {
  const app = express();
  app.use(requestContext);
  app.use(express.json({ limit: '100kb' }));
  mount(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('route()', () => {
  it('wraps a returned value in the documented success envelope', async () => {
    const app = testApp((a) => {
      a.get('/thing', route({ handler: () => ({ id: 'thing_1' }) }));
    });

    const res = await request(app).get('/thing').set('x-request-id', 'trace-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { id: 'thing_1' }, meta: { requestId: 'trace-1' } });
  });

  it('validates the body server-side and reports the failing fields', async () => {
    const app = testApp((a) => {
      a.post(
        '/orders',
        route({
          body: z.object({
            items: z.array(z.object({ quantity: z.number().int().positive() })).min(1),
          }),
          handler: ({ body }) => ({ count: body.items.length }),
        }),
      );
    });

    const res = await request(app)
      .post('/orders')
      .send({ items: [{ quantity: 0 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveLength(1);
    expect(res.body.error.details[0].field).toBe('items[0].quantity');
    expect(res.body.error.requestId).toBeTypeOf('string');
  });

  it('names the request part when the failure is not about one field', async () => {
    const app = testApp((a) => {
      a.post(
        '/orders',
        route({
          body: z.object({ quantity: z.number() }),
          handler: () => ({ ok: true }),
        }),
      );
    });

    const res = await request(app)
      .post('/orders')
      .set('content-type', 'application/json')
      .send('[]');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('body');
  });

  it('applies the shared pagination caps to query input', async () => {
    const app = testApp((a) => {
      a.get(
        '/products',
        route({
          query: paginationQuery,
          handler: ({ query }) => toSkipTake(query),
        }),
      );
    });

    const defaults = await request(app).get('/products');
    expect(defaults.body.data).toEqual({ skip: 0, take: 20 });

    const paginated = await request(app).get('/products?page=3&pageSize=10');
    expect(paginated.body.data).toEqual({ skip: 20, take: 10 });

    const tooLarge = await request(app).get('/products?pageSize=5000');
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.details[0].field).toBe('pageSize');
  });

  it('rejects a sort value that is not allow-listed', async () => {
    const app = testApp((a) => {
      a.get(
        '/products',
        route({
          query: sortQuery(['newest', 'price_asc'], 'newest'),
          handler: ({ query }) => ({ sort: query.sort }),
        }),
      );
    });

    expect((await request(app).get('/products')).body.data).toEqual({ sort: 'newest' });
    expect((await request(app).get('/products?sort=price_asc')).body.data).toEqual({
      sort: 'price_asc',
    });

    const injected = await request(app).get('/products?sort=price%20desc%3B%20drop%20table');
    expect(injected.status).toBe(400);
    expect(injected.body.error.details[0].field).toBe('sort');
  });

  it('validates path params', async () => {
    const app = testApp((a) => {
      a.get(
        '/orders/:orderId',
        route({
          params: idParams('orderId'),
          handler: ({ params }) => ({ orderId: params.orderId }),
        }),
      );
    });

    const ok = await request(app).get('/orders/ckv9t2x1m0000qzrmn831i7rn');
    expect(ok.body.data).toEqual({ orderId: 'ckv9t2x1m0000qzrmn831i7rn' });

    const junk = await request(app).get('/orders/%27%20OR%201%3D1%20--');
    expect(junk.status).toBe(400);
    expect(junk.body.error.details[0].field).toBe('orderId');
  });

  it('supports explicit statuses and extra meta', async () => {
    const app = testApp((a) => {
      a.post('/created', route({ handler: () => created({ id: 'new_1' }) }));
      a.post('/accepted', route({ handler: () => accepted({ jobId: 'job_1' }) }));
      a.delete('/gone', route({ handler: () => noContent() }));
      a.get(
        '/custom',
        route({ handler: () => respond({ ok: true }, { meta: { cached: false } }) }),
      );
    });

    const createdRes = await request(app).post('/created');
    expect(createdRes.status).toBe(201);
    expect(createdRes.body.data).toEqual({ id: 'new_1' });

    expect((await request(app).post('/accepted')).status).toBe(202);

    const deleted = await request(app).delete('/gone');
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');

    const custom = await request(app).get('/custom');
    expect(custom.body.meta).toMatchObject({ cached: false });
  });

  it('emits the collection envelope for a paged result', async () => {
    const app = testApp((a) => {
      a.get(
        '/products',
        route({ handler: () => paged([{ id: 'p1' }], { page: 2, pageSize: 20, total: 41 }) }),
      );
    });

    const res = await request(app).get('/products');

    expect(res.body.data).toEqual([{ id: 'p1' }]);
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 20, total: 41 });
    expect(res.body.meta.requestId).toBeTypeOf('string');
  });

  it('maps a thrown domain error to its documented status with no try/catch in the route', async () => {
    const app = testApp((a) => {
      a.get(
        '/missing',
        route({
          handler: async () => {
            await Promise.resolve();
            throw notFound('No such product.');
          },
        }),
      );
      a.post(
        '/duplicate',
        route({
          handler: () => {
            throw conflict('That SKU already exists.');
          },
        }),
      );
    });

    const missing = await request(app).get('/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'No such product.' });

    const duplicate = await request(app).post('/duplicate');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('answers an unexpected failure generically', async () => {
    const app = testApp((a) => {
      a.get(
        '/broken',
        route({
          handler: async () => {
            await Promise.resolve();
            throw new Error('relation "products" does not exist');
          },
        }),
      );
    });

    const res = await request(app).get('/broken');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('The request could not be processed.');
    expect(res.body.error.stack).toBeUndefined();
    // Outside production the handler adds a `debug` string; nothing else may appear.
    const errorBody: Record<string, unknown> = res.body.error;
    expect(Object.keys(errorBody).sort()).toEqual(['code', 'debug', 'message', 'requestId']);
  });
});

describe('requestContext', () => {
  it('ignores a caller-supplied id that is not an opaque token', async () => {
    const app = testApp((a) => {
      a.get('/thing', route({ handler: () => ({ ok: true }) }));
    });

    const res = await request(app).get('/thing').set('x-request-id', 'trace one <script>');

    expect(res.body.meta.requestId).not.toContain('script');
    expect(res.body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
