import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  forwardedClientIp,
} from '../src/http/client-ip.js';
import { errorHandler } from '../src/http/error-handler.js';
import { requestContext } from '../src/http/request-context.js';
import { createOutboxCronRouter, drainAfterWrites } from '../src/modules/jobs/cron.routes.js';
import {
  type DrainSummary,
  createDrainCoalescer,
  drainDueJobs,
} from '../src/modules/jobs/drain.js';
import type { BatchSummary } from '../src/modules/jobs/worker.js';

/** ADR 0028: what lets the API run as a Vercel function behind the storefront's /api proxy. */

const SECRET = 'a-proxy-secret-that-is-long-enough-to-pass';

function ipEcho(secret: string | undefined) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(forwardedClientIp(secret));
  app.get('/ip', (req, res) => {
    res.json({
      ip: req.ip,
      secretHeader: req.headers[PROXY_SECRET_HEADER] ?? null,
      ipHeader: req.headers[PROXY_CLIENT_IP_HEADER] ?? null,
    });
  });
  return app;
}

describe('forwarded client address', () => {
  it('believes the storefront when it presents the shared secret', async () => {
    const res = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, SECRET)
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('accepts an IPv6 visitor address', async () => {
    const res = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, SECRET)
      .set(PROXY_CLIENT_IP_HEADER, '2001:db8::1');

    expect(res.body.ip).toBe('2001:db8::1');
  });

  it('ignores a claimed address without the right secret', async () => {
    const wrong = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, `${SECRET}-but-not-quite`)
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7');
    const missing = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7');

    expect(wrong.body.ip).not.toBe('203.0.113.7');
    expect(missing.body.ip).not.toBe('203.0.113.7');
  });

  it('ignores the headers entirely when no secret is configured', async () => {
    const res = await request(ipEcho(undefined))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, SECRET)
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7');

    expect(res.body.ip).not.toBe('203.0.113.7');
  });

  it('refuses something that is not an address, even with the secret', async () => {
    const res = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, SECRET)
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7, 198.51.100.1');

    expect(res.body.ip).not.toContain('203.0.113.7');
  });

  it('removes both headers so nothing downstream can read or log the secret', async () => {
    const res = await request(ipEcho(SECRET))
      .get('/ip')
      .set(PROXY_SECRET_HEADER, SECRET)
      .set(PROXY_CLIENT_IP_HEADER, '203.0.113.7');

    expect(res.body.secretHeader).toBeNull();
    expect(res.body.ipHeader).toBeNull();
  });
});

const SUMMARY: DrainSummary = {
  batches: 1,
  claimed: 2,
  sent: 2,
  skipped: 0,
  retrying: 0,
  dead: 0,
  lost: 0,
  drained: true,
};

function cronApp(secret: string | undefined, drain = vi.fn(() => Promise.resolve(SUMMARY))) {
  const app = express();
  app.use(requestContext);
  app.use('/api/v1/internal', createOutboxCronRouter({ secret, drain }));
  app.use(errorHandler);
  return { app, drain };
}

const CRON_SECRET = 'cron-secret-at-least-16';

describe('scheduled outbox drain', () => {
  it('does not exist without a configured secret', async () => {
    const { app, drain } = cronApp(undefined);
    const res = await request(app)
      .get('/api/v1/internal/outbox/drain')
      .set('authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(404);
    expect(drain).not.toHaveBeenCalled();
  });

  it('refuses a caller without the bearer secret', async () => {
    const { app, drain } = cronApp(CRON_SECRET);
    const missing = await request(app).get('/api/v1/internal/outbox/drain');
    const wrong = await request(app)
      .get('/api/v1/internal/outbox/drain')
      .set('authorization', `Bearer ${CRON_SECRET}x`);
    const bare = await request(app)
      .get('/api/v1/internal/outbox/drain')
      .set('authorization', CRON_SECRET);

    expect([missing.status, wrong.status, bare.status]).toEqual([401, 401, 401]);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');
    expect(drain).not.toHaveBeenCalled();
  });

  it('drains for Vercel Cron (GET) and for other schedulers (POST)', async () => {
    const { app, drain } = cronApp(CRON_SECRET);
    const viaGet = await request(app)
      .get('/api/v1/internal/outbox/drain')
      .set('authorization', `Bearer ${CRON_SECRET}`);
    const viaPost = await request(app)
      .post('/api/v1/internal/outbox/drain')
      .set('authorization', `Bearer ${CRON_SECRET}`);

    expect(viaGet.status).toBe(200);
    expect(viaGet.body.data).toEqual(SUMMARY);
    expect(viaPost.status).toBe(200);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});

function batch(claimed: number): BatchSummary {
  return { claimed, sent: claimed, skipped: 0, retrying: 0, dead: 0, lost: 0 };
}

describe('drainDueJobs', () => {
  it('stops at the first pass that finds fewer jobs than a batch', async () => {
    const runBatch = vi
      .fn<() => Promise<BatchSummary>>()
      .mockResolvedValueOnce(batch(10))
      .mockResolvedValueOnce(batch(3));
    const ensureRecurring = vi.fn(() => Promise.resolve());

    const summary = await drainDueJobs({ runBatch, ensureRecurring, batchSize: 10 });

    expect(summary).toMatchObject({ batches: 2, claimed: 13, sent: 13, drained: true });
    expect(ensureRecurring).toHaveBeenCalledOnce();
  });

  it('stops at its batch limit and says the queue may not be empty', async () => {
    const runBatch = vi.fn(() => Promise.resolve(batch(10)));

    const summary = await drainDueJobs({
      runBatch,
      ensureRecurring: false,
      batchSize: 10,
      maxBatches: 3,
    });

    expect(summary).toMatchObject({ batches: 3, claimed: 30, drained: false });
  });

  it('starts no new pass once its time budget is spent', async () => {
    let clock = 0;
    const runBatch = vi.fn(() => {
      clock += 600;
      return Promise.resolve(batch(10));
    });

    const summary = await drainDueJobs({
      runBatch,
      ensureRecurring: false,
      batchSize: 10,
      budgetMs: 1_000,
      now: () => clock,
    });

    expect(runBatch).toHaveBeenCalledTimes(2);
    expect(summary.drained).toBe(false);
  });
});

describe('drain after writes', () => {
  it('runs one drain at a time and one more pass for writes that arrive meanwhile', async () => {
    let release: () => void = () => undefined;
    const drain = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const kick = createDrainCoalescer(drain);

    const first = kick();
    const second = kick();
    const third = kick();
    expect(drain).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(2);
    });
    release();
    await Promise.all([first, second, third]);

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed drain from rejecting, and can run again afterwards', async () => {
    const drain = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);
    const kick = createDrainCoalescer(drain);

    await expect(kick()).resolves.toBeUndefined();
    await expect(kick()).resolves.toBeUndefined();
    expect(drain).toHaveBeenCalledTimes(2);
  });

  function writeApp(status: number) {
    const drain = vi.fn(() => Promise.resolve());
    const pending: Promise<unknown>[] = [];
    const app = express();
    app.use(drainAfterWrites({ drain, waitUntil: (promise) => pending.push(promise) }));
    app.all('/thing', (_req, res) => {
      res.status(status).json({ ok: status < 400 });
    });
    return { app, drain, pending };
  }

  it('drains after a successful write and holds the invocation until it ends', async () => {
    const { app, drain, pending } = writeApp(201);

    await request(app).post('/thing');
    await Promise.all(pending);

    expect(pending).toHaveLength(1);
    expect(drain).toHaveBeenCalledOnce();
  });

  it('leaves reads and refused writes alone', async () => {
    const refused = writeApp(429);
    await request(refused.app).post('/thing');
    await Promise.all(refused.pending);

    const read = writeApp(200);
    await request(read.app).get('/thing');

    expect(refused.drain).not.toHaveBeenCalled();
    expect(read.drain).not.toHaveBeenCalled();
    expect(read.pending).toHaveLength(0);
  });
});
