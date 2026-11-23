import type { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';

import type { Actor } from '../../http/guards.js';
import { opaqueId, paginationQuery } from '../../http/schemas.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';
import { dateRangeQuery, resolveRange } from '../analytics/date-range.js';
import { AuditAction } from './audit.service.js';

/**
 * `GET /admin/audit-logs` (M10, ADR 0022): who did what to which record, newest first.
 *
 * Read-only: nothing in the API edits or deletes an audit row. The before/after values were
 * redacted when they were written (`recordAudit`). The IP address is shown to superadmins only:
 * the people reading this log are often the people it is about.
 */
const ACTIONS = Object.values(AuditAction) as [string, ...string[]];

export const auditLogQuery = paginationQuery
  .extend({
    action: z.enum(ACTIONS).optional(),
    entityType: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{1,40}$/)
      .optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorUserId: opaqueId.optional(),
  })
  .and(dateRangeQuery);

export type AuditLogQuery = z.output<typeof auditLogQuery>;

export interface AuditLogView {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly isSystem: boolean;
  readonly actor: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  } | null;
  readonly actorRole: UserRole | null;
  readonly before: Prisma.JsonValue;
  readonly after: Prisma.JsonValue;
  readonly requestId: string | null;
  /** Superadmins only. */
  readonly ipAddress?: string | null;
  readonly createdAt: Date;
}

export async function listAuditLogs(
  pagination: Pagination,
  query: Omit<AuditLogQuery, 'page' | 'pageSize'>,
  viewer: Actor,
): Promise<{ items: AuditLogView[]; total: number }> {
  const { skip, take } = toSkipTake(pagination);
  const dated = query.from !== undefined || query.to !== undefined;
  const range = dated ? resolveRange(query, { defaultDays: 366 }) : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(range ? { createdAt: { gte: range.start, lt: range.end } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const showIp = viewer.role === 'SUPERADMIN';

  return {
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      isSystem: row.isSystem,
      actor: row.actor,
      actorRole: row.actorRole,
      before: row.beforeData,
      after: row.afterData,
      requestId: row.requestId,
      ...(showIp ? { ipAddress: row.ipAddress } : {}),
      createdAt: row.createdAt,
    })),
    total,
  };
}
