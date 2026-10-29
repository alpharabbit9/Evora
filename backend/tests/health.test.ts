import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '../src/app.js';

const app = createApp();

describe('health endpoints', () => {
  it('answers liveness in the documented success envelope', async () => {
    const res = await request(app).get(`${API_PREFIX}/livez`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok' });
    expect(res.body.meta.requestId).toBeTypeOf('string');
    expect(res.headers['x-request-id']).toBeTypeOf('string');
  });

  it('echoes a caller-supplied request id so logs can be correlated', async () => {
    const res = await request(app).get(`${API_PREFIX}/livez`).set('x-request-id', 'trace-abc-123');

    expect(res.body.meta.requestId).toBe('trace-abc-123');
  });

  it('returns the documented error envelope for an unknown route', async () => {
    const res = await request(app).get(`${API_PREFIX}/does-not-exist`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTypeOf('string');
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
  });
});
