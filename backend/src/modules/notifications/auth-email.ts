import { createHash } from 'node:crypto';

import type { OutboxEventType } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Better Auth produces the verification / password-reset URL; this module decides how it
 * travels. It is written to the durable outbox instead of being handed to an email provider
 * inline, for the reason architecture.md §11 and commerce invariant 9 give: a provider
 * outage must not be able to fail the request that triggered it. Sign-up still succeeds and
 * `POST /auth/forget-password` still answers 200 when the mail system is down — the row
 * simply waits.
 *
 * NOT YET DELIVERED. The outbox worker is M9 and no email provider has been selected
 * (PRD §9). Until then these rows accumulate with status PENDING and nothing is sent. The
 * HTTP flows below them are real and tested; delivery is not. Do not describe email
 * verification or password reset as "working" to an end user on that basis.
 *
 * Token handling: the payload carries the URL because that is what an email has to contain.
 * That means a reset token is readable by anyone with database access between enqueue and
 * send, which is the same exposure as any outbox-backed mail system. It is bounded by
 * `resetPasswordTokenExpiresIn` (1 hour) rather than by the row's lifetime, and the M9
 * worker must clear `payload` once a row reaches SENT. Nothing here is ever logged.
 */
export type AuthEmailType =
  typeof OutboxEventType.EMAIL_VERIFICATION | typeof OutboxEventType.PASSWORD_RESET;

/** Structural, so this module does not depend on Better Auth's exported `User` type. */
export interface AuthEmailRecipient {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface AuthEmailRequest {
  readonly type: AuthEmailType;
  readonly recipient: AuthEmailRecipient;
  /** Verification / reset link. Contains the token; never log it. */
  readonly url: string;
  /** Used only to derive a stable dedupe key — the raw value is not stored in it. */
  readonly token: string;
}

/**
 * Stable job identity (architecture.md §11). Derived from a hash of the token so that the
 * same send retried is one row, while a genuinely new reset request — which carries a new
 * token — is a new row. The raw token never appears in the key.
 */
function dedupeKeyFor(type: AuthEmailType, token: string): string {
  return `${type}:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

export async function enqueueAuthEmail(request: AuthEmailRequest): Promise<void> {
  const dedupeKey = dedupeKeyFor(request.type, request.token);

  // `update: {}` so a retried send does not reset the worker's attempt count or schedule.
  const event = await prisma.outboxEvent.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      eventType: request.type,
      dedupeKey,
      payload: {
        userId: request.recipient.id,
        email: request.recipient.email,
        name: request.recipient.name,
        url: request.url,
      },
    },
  });

  // Identifiers only: no URL, no token, no password.
  logger.info(
    { outboxEventId: event.id, eventType: request.type, userId: request.recipient.id },
    'Queued authentication email in the outbox (delivery pending an email provider)',
  );
}
