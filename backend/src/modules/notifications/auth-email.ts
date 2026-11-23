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
 * Delivered by the outbox worker (`src/worker.ts`, ADR 0021) through the configured email
 * transport. In development that is the filesystem driver, which writes an `.eml` file under
 * MAIL_ROOT and sends nothing; real delivery needs EMAIL_DRIVER=smtp and a relay. A row that is
 * still PENDING when its link has expired is not sent: the worker marks it DEAD.
 *
 * Token handling: the payload carries the URL because that is what an email has to contain.
 * That means a reset token is readable by anyone with database access between enqueue and
 * send, which is the same exposure as any outbox-backed mail system. It is bounded by
 * `AUTH_LINK_TTL_MS` rather than by the row's lifetime, and the worker replaces the payload
 * once the row is SENT or DEAD (`SCRUB_ON_FINISH`). Nothing here is ever logged.
 */
export type AuthEmailType =
  typeof OutboxEventType.EMAIL_VERIFICATION | typeof OutboxEventType.PASSWORD_RESET;

/**
 * How long each link works. `src/lib/auth.ts` gives these to Better Auth, and the worker refuses
 * to send a link older than this, so the two cannot drift apart.
 */
export const AUTH_LINK_TTL_MS: Readonly<Record<AuthEmailType, number>> = {
  PASSWORD_RESET: 60 * 60 * 1000,
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
};

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
    'Queued authentication email in the outbox',
  );
}
