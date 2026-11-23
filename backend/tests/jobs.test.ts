import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  decideFailure,
  isScrubbed,
  jobSubject,
  retryDelayMs,
  safeErrorMessage,
  scrubbedPayload,
} from '../src/modules/jobs/job-policy.js';
import {
  escapeHtml,
  formatMoney,
  passwordResetEmail,
  receiptEmail,
  reviewReasonText,
} from '../src/modules/notifications/templates.js';
import {
  EmailDeliveryError,
  classifyMailerError,
  createDisabledTransport,
  createFilesystemTransport,
  messageIdFor,
} from '../src/modules/notifications/transport.js';

/** M9 (ADR 0021): the worker's pure rules, the email templates and the transport's edges. */

describe('retry delay', () => {
  it('doubles from the base, with half of it jitter', () => {
    expect(retryDelayMs(1, () => 0)).toBe(RETRY_BASE_MS / 2);
    expect(retryDelayMs(1, () => 1)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2, () => 0)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(3, () => 1)).toBe(RETRY_BASE_MS * 4);
  });

  it('is bounded by the cap however many tries have failed', () => {
    for (const attempt of [10, 20, 100]) {
      expect(retryDelayMs(attempt, () => 1)).toBe(RETRY_CAP_MS);
      expect(retryDelayMs(attempt, () => 0)).toBe(RETRY_CAP_MS / 2);
    }
  });

  it('stays in range for a random source that misbehaves', () => {
    expect(retryDelayMs(1, () => 5)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(1, () => -1)).toBe(RETRY_BASE_MS / 2);
  });
});

describe('failure decision', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const base = { now, recurringIntervalMs: 300_000, random: () => 0 } as const;

  it('retries a one-off job until its last try, then gives up', () => {
    const retry = decideFailure({
      ...base,
      eventType: 'ORDER_RECEIPT',
      attemptCount: 1,
      permanent: false,
    });
    expect(retry.status).toBe('FAILED');
    expect(retry.nextAttemptAt.getTime() - now.getTime()).toBe(RETRY_BASE_MS / 2);

    expect(
      decideFailure({
        ...base,
        eventType: 'ORDER_RECEIPT',
        attemptCount: MAX_ATTEMPTS,
        permanent: false,
      }).status,
    ).toBe('DEAD');
  });

  it('gives up at once on a permanent failure', () => {
    expect(
      decideFailure({ ...base, eventType: 'SHIPPING_UPDATE', attemptCount: 1, permanent: true })
        .status,
    ).toBe('DEAD');
  });

  it('never gives up on the recurring sweep, and retries it within its interval', () => {
    const decision = decideFailure({
      ...base,
      random: () => 1,
      eventType: 'PAYMENT_RECONCILIATION',
      attemptCount: 50,
      permanent: true,
    });
    expect(decision.status).toBe('FAILED');
    expect(decision.nextAttemptAt.getTime() - now.getTime()).toBe(300_000);
  });
});

describe('what may be stored and shown', () => {
  it('removes addresses and links from an error, and shortens it', () => {
    const message = safeErrorMessage(
      new Error('550 <buyer@example.com> rejected; see https://relay.test/a?token=x\n\nbye'),
    );
    expect(message).toBe('550 <[email]> rejected; see [url] bye');
    expect(safeErrorMessage(new Error('x'.repeat(2000))).length).toBe(500);
    expect(safeErrorMessage('')).toBe('Unknown error');
  });

  it('describes a job by allow-listed identifiers only', () => {
    expect(
      jobSubject({
        orderId: 'o1',
        orderNumber: 'ORD-1',
        email: 'a@b.test',
        url: 'https://x',
        sku: 7,
      }),
    ).toEqual({ orderId: 'o1', orderNumber: 'ORD-1' });
    expect(jobSubject(null)).toEqual({});
  });

  it('keeps only the user id of an account email once it is finished', () => {
    const scrubbed = scrubbedPayload({ userId: 'u1', email: 'a@b.test', url: 'https://x/secret' });
    expect(scrubbed).toEqual({ userId: 'u1', scrubbed: true });
    expect(isScrubbed(scrubbed)).toBe(true);
    expect(isScrubbed({ userId: 'u1' })).toBe(false);
    expect(isScrubbed(null)).toBe(false);
  });
});

describe('templates', () => {
  it('escapes everything a person typed', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;',
    );

    const email = receiptEmail({
      storeName: 'Store',
      orderNumber: 'ORD-1',
      orderUrl: 'https://shop.test/orders/1',
      recipientName: '<script>alert(1)</script>',
      paymentMethod: 'COD',
      currency: 'BDT',
      items: [
        { name: 'Shoe <img src=x>', options: 'M / Black', quantity: 2, lineTotalMinor: 500_000 },
      ],
      subtotalMinor: 500_000,
      discountMinor: 0,
      shippingMinor: 6_000,
      taxMinor: 0,
      totalMinor: 506_000,
      shipTo: ['Test Person', '1 Road', 'Dhaka'],
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain('Shoe <img src=x> (M / Black) × 2');
    expect(email.text).toContain('৳5,060');
    expect(email.text).toContain('pay in cash');
    expect(email.text).toContain('https://shop.test/orders/1');
  });

  it('formats money as the storefront does', () => {
    expect(formatMoney(285_000, 'BDT')).toBe('৳2,850');
    expect(formatMoney(285_050, 'BDT')).toBe('৳2,850.50');
  });

  it('puts the reset link in both bodies', () => {
    const email = passwordResetEmail({
      storeName: 'Store',
      recipientName: 'Ann',
      url: 'https://api.test/reset/abc?callbackURL=https%3A%2F%2Fshop.test',
    });
    expect(email.text).toContain('https://api.test/reset/abc?callbackURL=https%3A%2F%2Fshop.test');
    expect(email.html).toContain(
      'href="https://api.test/reset/abc?callbackURL=https%3A%2F%2Fshop.test"',
    );
  });

  it('words every review reason, and falls back for a new one', () => {
    expect(reviewReasonText('PAID_AFTER_CLOSE')).toMatch(/after the order had closed/);
    expect(reviewReasonText('SOMETHING_NEW')).toBe('Reason code: SOMETHING_NEW.');
  });
});

describe('email transport', () => {
  it('treats a relay refusal as permanent and a dropped connection as worth retrying', () => {
    expect(classifyMailerError({ code: 'EENVELOPE', message: 'No recipients' }).permanent).toBe(
      true,
    );
    expect(
      classifyMailerError({ responseCode: 550, permanent: true, message: 'no user' }).permanent,
    ).toBe(true);
    expect(
      classifyMailerError({ responseCode: 421, permanent: false, message: 'busy' }).permanent,
    ).toBe(false);
    expect(classifyMailerError({ code: 'ECONNECTION', message: 'refused' }).permanent).toBe(false);
    expect(classifyMailerError(new Error('boom'))).toBeInstanceOf(EmailDeliveryError);
  });

  it('gives a job the same Message-ID every time it is sent', () => {
    expect(messageIdFor('order-receipt:1')).toBe(messageIdFor('order-receipt:1'));
    expect(messageIdFor('order-receipt:1')).not.toBe(messageIdFor('order-receipt:2'));
    expect(messageIdFor('order-receipt:1')).toMatch(/^<[0-9a-f]{32}@[^>]+>$/);
  });

  it('fails every send permanently when email is disabled, never reporting a delivery', async () => {
    const transport = createDisabledTransport();
    const sent = transport.send({
      to: ['buyer@example.test'],
      subject: 'Order ORD-1 confirmed',
      text: 'Thanks',
      html: '<p>Thanks</p>',
      idempotencyKey: 'order-receipt:1',
    });

    await expect(sent).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sent).rejects.toMatchObject({
      permanent: true,
      message: expect.stringMatching(/EMAIL_DRIVER=disabled/),
    });
    expect(transport.name).toBe('disabled');
    // Permanent means a one-off email job goes straight to DEAD instead of retrying for hours.
    expect(
      decideFailure({
        now: new Date('2026-11-10T10:00:00Z'),
        recurringIntervalMs: 300_000,
        random: () => 0,
        eventType: 'PASSWORD_RESET',
        attemptCount: 1,
        permanent: true,
      }).status,
    ).toBe('DEAD');
  });

  it('writes one .eml file per job in development, overwriting a resend', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cc-mail-'));

    try {
      const transport = createFilesystemTransport(root);
      const message = {
        to: ['buyer@example.test'],
        subject: 'Order ORD-1 confirmed',
        text: 'Hello',
        html: '<p>Hello</p>',
        idempotencyKey: 'order-receipt:1',
      };

      await transport.send(message);
      await transport.send(message);

      const files = await readdir(root);
      expect(files).toHaveLength(1);
      const raw = await readFile(path.join(root, files[0] ?? ''), 'utf8');
      expect(raw).toContain('Subject: Order ORD-1 confirmed');
      expect(raw).toContain(`Message-ID: ${messageIdFor('order-receipt:1')}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
