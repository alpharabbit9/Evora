import { UserRole, UserStatus } from '@prisma/client';

import { forbidden, notFound } from '../../http/errors.js';
import { type Actor, roleRank } from '../../http/guards.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';

/**
 * Administrative customer management (API_SPEC.md §8, PRD §4 FR-05 "customer status/role
 * management with least privilege").
 *
 * Two privilege rules are enforced here rather than at the route, because they depend on
 * the target row and the route only knows the caller:
 *
 *  1. Nobody changes their own role or status. That is what makes self-escalation
 *     structurally impossible rather than merely unlikely, and it stops an admin locking
 *     themselves out by accident.
 *  2. Touching a privileged account requires SUPERADMIN. An ADMIN manages customers; it
 *     may not suspend a peer administrator or the owner account.
 *
 * Granting a role is SUPERADMIN-only, enforced by the route guard. An ADMIN that could
 * promote an ADMIN would make the whole ladder decorative.
 *
 * Both operations write an audit row in the same transaction as the change (invariant 8).
 */
export interface CustomerView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

/** Who did it and from where, for the audit row. Supplied by the route. */
export interface AdminActionContext {
  readonly actor: Actor;
  readonly ipAddress?: string;
  readonly requestId?: string;
}

export interface CustomerFilters {
  /** Matched against email and name, case-insensitively. */
  readonly q?: string;
  readonly role?: UserRole;
  readonly status?: UserStatus;
}

export interface CustomerPage {
  readonly items: readonly CustomerView[];
  readonly total: number;
}

export async function listCustomers(
  pagination: Pagination,
  filters: CustomerFilters,
): Promise<CustomerPage> {
  const { skip, take } = toSkipTake(pagination);

  // `contains` with a parameterised value — Prisma binds it; no caller text is
  // interpolated into SQL (API_SPEC.md §1).
  const where = {
    ...(filters.q === undefined
      ? {}
      : {
          OR: [
            { email: { contains: filters.q, mode: 'insensitive' as const } },
            { name: { contains: filters.q, mode: 'insensitive' as const } },
          ],
        }),
    ...(filters.role === undefined ? {} : { role: filters.role }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: CUSTOMER_SELECT,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total };
}

async function loadTarget(userId: string): Promise<CustomerView> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: CUSTOMER_SELECT });

  if (!target) {
    throw notFound('That customer does not exist.');
  }

  return target;
}

/** Rule 2: an ADMIN may only act on an unprivileged account. */
function assertMayManage(actor: Actor, target: CustomerView): void {
  if (roleRank(target.role) < roleRank(UserRole.ADMIN)) {
    return;
  }

  if (actor.role === UserRole.SUPERADMIN) {
    return;
  }

  logger.warn(
    { actorId: actor.id, actorRole: actor.role, targetId: target.id, targetRole: target.role },
    'Refused an administrative change to a privileged account',
  );
  throw forbidden('Changing a privileged account requires a superadmin.');
}

/** Rule 1. Separated out so both operations state it the same way. */
function assertNotSelf(actor: Actor, targetId: string, what: string): void {
  if (actor.id === targetId) {
    throw forbidden(`You cannot change your own ${what}.`);
  }
}

export async function updateCustomerStatus(
  targetUserId: string,
  status: UserStatus,
  context: AdminActionContext,
): Promise<CustomerView> {
  const { actor } = context;
  const target = await loadTarget(targetUserId);

  assertNotSelf(actor, target.id, 'account status');
  assertMayManage(actor, target);

  return withTransaction(
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { status },
        select: CUSTOMER_SELECT,
      });

      /**
       * Suspension has to bite immediately, so the account's live sessions go with it.
       * Without this the guard would refuse new requests only once each session expired,
       * which for this configuration is up to seven days.
       *
       * Sessions are deleted directly rather than through Better Auth because its
       * session-revocation API acts on the caller's own sessions; there is no cross-user
       * revocation without the admin plugin, which this project does not use (ADR 0009).
       * Deleting the rows is what that plugin does too, and it is authoritative here
       * because `session.cookieCache` is disabled.
       */
      if (status === UserStatus.SUSPENDED) {
        const { count } = await tx.session.deleteMany({ where: { userId: target.id } });
        logger.info({ targetId: target.id, revokedSessions: count }, 'Suspended an account');
      }

      await recordAudit(tx, {
        action: AuditAction.CUSTOMER_STATUS_UPDATED,
        entityType: 'User',
        entityId: target.id,
        actor,
        before: { status: target.status },
        after: { status: updated.status },
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      });

      return updated;
    },
    { label: 'admin.updateCustomerStatus' },
  );
}

export async function updateCustomerRole(
  targetUserId: string,
  role: UserRole,
  context: AdminActionContext,
): Promise<CustomerView> {
  const { actor } = context;
  const target = await loadTarget(targetUserId);

  assertNotSelf(actor, target.id, 'role');

  return withTransaction(
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { role },
        select: CUSTOMER_SELECT,
      });

      /**
       * A demotion needs no session revocation: every request re-reads the role from the
       * database (`session.cookieCache` is off), so the next request the demoted user
       * makes is already authorized at the new level.
       */
      await recordAudit(tx, {
        action: AuditAction.CUSTOMER_ROLE_UPDATED,
        entityType: 'User',
        entityId: target.id,
        actor,
        before: { role: target.role },
        after: { role: updated.role },
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      });

      logger.info(
        { actorId: actor.id, targetId: target.id, from: target.role, to: updated.role },
        'Changed an account role',
      );

      return updated;
    },
    { label: 'admin.updateCustomerRole' },
  );
}
