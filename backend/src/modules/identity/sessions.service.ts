import { notFound } from '../../http/errors.js';
import { auth } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

/**
 * The caller's own active sessions, for a "signed in on these devices" view and for
 * revoking one of them.
 *
 * Why this exists instead of proxying Better Auth's `/list-sessions`: that endpoint
 * returns whole session rows, and a session row contains `token` — the value the session
 * cookie carries. Serving it to the browser would put a bearer-equivalent credential
 * inside reach of any script on the page, which is the thing `httpOnly` is for. So the
 * listing is projected here and the token never leaves the server. (`/auth/list-sessions`
 * is also blocked at the Express layer for the same reason; see `src/app.ts`.)
 *
 * Revocation itself is NOT reimplemented: the id is resolved to its token server-side and
 * handed to `auth.api.revokeSession`, so Better Auth stays the only thing that ends a
 * session.
 */
export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** The session this request was made with. A client should confirm before ending it. */
  readonly current: boolean;
}

export async function listOwnSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionView[]> {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    // `token` is deliberately absent.
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
  });

  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
}

/**
 * Ends one of the caller's own sessions. Scoped by `userId`, so another user's session id
 * is simply not found — a 404, which also means the id cannot be used to probe for
 * existence.
 */
export async function revokeOwnSession(
  userId: string,
  sessionId: string,
  headers: Headers,
): Promise<void> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    select: { token: true },
  });

  if (!session) {
    throw notFound('That session does not exist.');
  }

  // Better Auth verifies the token belongs to the caller again before deleting it.
  await auth.api.revokeSession({ body: { token: session.token }, headers });
}
