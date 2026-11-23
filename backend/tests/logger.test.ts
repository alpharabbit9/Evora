import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { LOG_REDACTION } from '../src/lib/logger.js';

/**
 * The application logger with its real redaction rules, writing to memory instead of the
 * pretty-printer, so each line can be read back exactly as a log pipeline would receive it.
 */
function capture(): { log: pino.Logger; lines: () => string } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });

  return { log: pino({ redact: LOG_REDACTION }, sink), lines: () => chunks.join('') };
}

const SECRET = 'do-not-log-me-7f3a';

describe('log redaction', () => {
  it.each([
    ['a top-level password', { password: SECRET }],
    ['a nested password', { body: { password: SECRET } }],
    ['a session token', { session: { token: SECRET } }],
    ['an OAuth refresh token', { account: { refreshToken: SECRET } }],
    ['the auth secret', { config: { secret: SECRET } }],
    ['a card number', { card: { cardNumber: SECRET, cvv: SECRET } }],
    ['the SSLCOMMERZ password, as sent', { request: { store_passwd: SECRET } }],
    ['the SSLCOMMERZ password, as configured', { config: { storePassword: SECRET } }],
    ['a password-reset link in an outbox payload', { event: { payload: { url: SECRET } } }],
    [
      'the Authorization and Cookie headers',
      { req: { headers: { authorization: SECRET, cookie: SECRET } } },
    ],
    ['a Set-Cookie header', { res: { headers: { 'set-cookie': SECRET } } }],
    ['an assistant provider key', { apiKey: SECRET }],
    ['an assistant provider key, nested', { config: { apiKey: SECRET } }],
    [
      'a provider request Authorization header',
      { request: { headers: { authorization: SECRET } } },
    ],
  ])('censors %s', (_label, fields) => {
    const { log, lines } = capture();

    log.info(fields, 'something happened');

    expect(lines()).not.toContain(SECRET);
    expect(lines()).toContain('[redacted]');
  });

  it('leaves identifiers that make a line useful', () => {
    const { log, lines } = capture();

    log.info({ userId: 'user_123', orderId: 'order_456', requestId: 'req-1' }, 'order placed');

    expect(lines()).toContain('user_123');
    expect(lines()).toContain('order_456');
  });
});
