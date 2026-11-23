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
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_ARCHIVED: 'product.archived',
  VARIANT_CREATED: 'variant.created',
  VARIANT_UPDATED: 'variant.updated',
  IMAGE_CREATED: 'image.created',
  IMAGE_UPDATED: 'image.updated',
  IMAGE_DELETED: 'image.deleted',
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  STOCK_ADJUSTED: 'inventory.stock.adjusted',
  ORDER_TRANSITIONED: 'order.transitioned',
  ORDER_COD_COLLECTED: 'order.cod.collected',
  REFUND_REQUESTED: 'refund.requested',
  PAYMENT_HOLD_RESOLVED: 'payment.hold.resolved',
  JOB_RETRIED: 'outbox.job.retried',
  JOBS_BULK_RETRIED: 'outbox.jobs.bulk_retried',
  COUPON_CREATED: 'coupon.created',
  COUPON_UPDATED: 'coupon.updated',
  SETTINGS_UPDATED: 'settings.updated',
  ORDERS_EXPORTED: 'orders.exported',
  /** Reading a customer's chat is itself recorded: it is personal text (ADR 0025). */
  ASSISTANT_CONVERSATION_VIEWED: 'assistant.conversation.viewed',
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
