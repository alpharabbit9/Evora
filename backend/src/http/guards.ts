import { UserRole, UserStatus } from '@prisma/client';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, RequestHandler } from 'express';

import { auth } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { forbidden, notFound, unauthenticated } from './errors.js';

/**
 * Authentication, role and ownership checks for protected server operations
 * (CLAUDE.md commerce invariants 7 and 8, architecture.md §4/§12).
 *
 * Every protected route composes these instead of re-reading the session itself, so an
 * endpoint cannot ship with a forgotten check — and a UI-only check is never mistaken
 * for authorization.
 *
 * Nothing here reads a user id, role or authentication flag off the request: the actor is
 * derived from the session Better Auth verified, and that is the only source.
 */
export interface Actor {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  /** True for ADMIN and SUPERADMIN. Shorthand for `hasAtLeastRole(actor, ADMIN)`. */
  readonly isAdmin: boolean;
  /** For audit records of sensitive admin actions (invariant 8). */
  readonly sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuth`/`requireMinRole`; read it through `actorOf(req)`. */
    actor?: Actor;
  }
}

/**
 * The privilege ladder, and the only place roles are ranked. Written as a total record so
 * adding an enum member is a type error here rather than a silently unranked role that
 * compares as least-privileged everywhere.
 *
 * SUPERADMIN outranks ADMIN so that granting a role is not itself an ADMIN-level operation
 * (PRD §4 FR-05 least privilege): an ADMIN runs the store, a SUPERADMIN decides who is an
 * ADMIN.
 */
const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  [UserRole.CUSTOMER]: 0,
  [UserRole.ADMIN]: 1,
  [UserRole.SUPERADMIN]: 2,
};

/** Least privilege: an unrecognised or missing role is CUSTOMER, never anything higher. */
export function toRole(value: unknown): UserRole {
  return typeof value === 'string' && value in ROLE_RANK ? (value as UserRole) : UserRole.CUSTOMER;
}

/** Position on the ladder. Exported so services can compare an actor against a target. */
export function roleRank(role: UserRole): number {
  return ROLE_RANK[role];
}

export function hasAtLeastRole(actor: Actor, minimum: UserRole): boolean {
  return ROLE_RANK[actor.role] >= ROLE_RANK[minimum];
}

/**
 * Fail closed: only an explicit ACTIVE status passes. `status` is non-null with a default
 * in the schema, so a missing value means the session payload is not what we expect —
 * which is logged rather than waved through.
 */
function assertActive(userId: string, status: unknown): void {
  if (status === UserStatus.ACTIVE) {
    return;
  }

  if (status === UserStatus.SUSPENDED) {
    throw forbidden('This account is suspended.');
  }

  logger.warn({ userId, status }, 'Session user has no recognisable status; denying request');
  throw forbidden('This account cannot be used right now.');
}

/**
 * Resolves the session once per request. Returns `undefined` for an anonymous caller —
 * callers decide whether that is allowed (guest cart and public catalog say yes).
 *
 * A failure to *reach* Better Auth or the database propagates as an error, so the error
 * middleware answers 500. An unauthenticated request and a broken session store are not
 * the same thing and must not both look like 401.
 */
export async function resolveActor(req: Request): Promise<Actor | undefined> {
  if (req.actor) {
    return req.actor;
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

  if (!session) {
    return undefined;
  }

  assertActive(session.user.id, session.user.status);

  const role = toRole(session.user.role);
  const actor: Actor = {
    id: session.user.id,
    email: session.user.email,
    role,
    isAdmin: ROLE_RANK[role] >= ROLE_RANK[UserRole.ADMIN],
    sessionId: session.session.id,
  };

  req.actor = actor;
  return actor;
}

/** Attaches the actor when there is a session, without requiring one. */
export const withActor: RequestHandler = async (req, _res, next) => {
  await resolveActor(req);
  next();
};

/** 401 unless a valid session exists for an active account. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const actor = await resolveActor(req);

  if (!actor) {
    throw unauthenticated();
  }

  next();
};

/**
 * 401 without a session, 403 below `minimum`. Deny by default: a route states the lowest
 * role it accepts and everything under it is refused.
 */
export function requireMinRole(minimum: UserRole): RequestHandler {
  return async (req, _res, next) => {
    const actor = await resolveActor(req);

    if (!actor) {
      throw unauthenticated();
    }

    if (!hasAtLeastRole(actor, minimum)) {
      logger.warn(
        { userId: actor.id, role: actor.role, required: minimum, path: req.path },
        'Role check denied a request',
      );
      throw forbidden();
    }

    next();
  };
}

/** The admin dashboard subtree (API_SPEC.md §8). SUPERADMIN passes too. */
export const requireAdmin = requireMinRole(UserRole.ADMIN);

/** Administrator and system-level management: granting roles, and nothing less. */
export const requireSuperadmin = requireMinRole(UserRole.SUPERADMIN);

/**
 * Reads the actor inside a handler. Throws rather than returning `undefined`, so a
 * handler that forgot its guard fails as 401 instead of acting on an anonymous caller.
 */
export function actorOf(req: Request): Actor {
  if (!req.actor) {
    throw unauthenticated();
  }

  return req.actor;
}

/**
 * Ownership check for a loaded resource (invariant 7). Defaults to answering 404 so a
 * caller cannot use the difference between 403 and 404 to discover that someone else's
 * order, address or cart exists.
 *
 * Prefer scoping the query itself by `{ id, userId: actor.id }` where that is possible —
 * a row that is never loaded cannot have its ownership check forgotten. Use this for the
 * cases where the resource has to be read first.
 *
 * Admins are not let through by default: admin access belongs on the `/admin` endpoints,
 * which have their own authorization and audit trail.
 */
export function assertOwner(
  ownerId: string,
  actor: Actor,
  options: { allowAdmin?: boolean; reveal?: boolean } = {},
): void {
  if (ownerId === actor.id) {
    return;
  }

  if (options.allowAdmin === true && actor.isAdmin) {
    return;
  }

  logger.warn({ userId: actor.id, ownerId }, 'Ownership check denied a request');
  throw options.reveal === true ? forbidden() : notFound();
}
