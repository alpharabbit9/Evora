import type { Prisma, UserRole } from '@prisma/client';

import type { Actor } from '../../http/guards.js';
import type { TransactionClient } from '../../lib/transaction.js';

/**
 * Audit trail for sensitive administrative actions (CLAUDE.md commerce invariant 8,
 * architecture.md §12: "audit role changes, inventory, refunds, coupons, settings and
 * admin transitions").
 *
 * The client is a `TransactionClient` rather than the global one on purpose: the audit row
 * is written in the same transaction as the change it describes. If the change commits and
 * the audit write fails, the record of who did it is gone — so they commit together or not
 * at all.
 *
 * `before`/`after` must be redacted by the caller. Pass the fields that changed, never a
 * whole row: no password hashes, no session tokens, no personal data the action did not
 * touch.
 */
export const AuditAction = {
  CUSTOMER_STATUS_UPDATED: 'customer.status.updated',
  CUSTOMER_ROLE_UPDATED: 'customer.role.updated',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  readonly action: AuditActionName;
  readonly entityType: string;
  readonly entityId: string;
  /** Omit for an action the system took on its own; a row needs an actor or `isSystem`. */
  readonly actor?: Actor;
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
  readonly ipAddress?: string;
  readonly requestId?: string;
}

export async function recordAudit(tx: TransactionClient, entry: AuditEntry): Promise<void> {
  const actorRole: UserRole | undefined = entry.actor?.role;

  await tx.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      isSystem: entry.actor === undefined,
      ...(entry.actor ? { actorUserId: entry.actor.id } : {}),
      ...(actorRole ? { actorRole } : {}),
      ...(entry.before === undefined ? {} : { beforeData: entry.before }),
      ...(entry.after === undefined ? {} : { afterData: entry.after }),
      ...(entry.ipAddress === undefined ? {} : { ipAddress: entry.ipAddress }),
      ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    },
  });
}
