'use client';

import { ScrollTextIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ADMIN_PAGE_SIZE, useAuditLog } from '@/lib/admin/api';
import { AUDIT_ACTION_LABEL, ROLE_LABEL, type AuditEntry } from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  FilterBar,
  FilterSelect,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
  toOptions,
} from '../admin-ui';

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL);

/** `{ status: 'ACTIVE' } → { status: 'SUSPENDED' }`, as lines a person can read. */
function changes(entry: AuditEntry): string[] {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const show = (value: unknown) => (value === undefined ? '—' : JSON.stringify(value));

  return keys.map((key) =>
    key in before && key in after
      ? `${key}: ${show(before[key])} → ${show(after[key])}`
      : `${key}: ${show(key in after ? after[key] : before[key])}`,
  );
}

/**
 * Who did what, newest first (ADR 0022). Read-only: nothing edits or deletes an entry. Values were
 * redacted when they were written. IP addresses are shown to superadmins only.
 */
export function AuditLog() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    action: params.getOneOf('action', ACTIONS),
    entityId: params.get('entityId'),
  };
  const log = useAuditLog(filters);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Audit log"
        description="Every sensitive change made in the dashboard, and the system's own: who, what, when, and what it changed."
      />

      <FilterBar>
        <FilterSelect
          label="Action"
          value={filters.action}
          onChange={(action) => {
            params.set({ action });
          }}
          options={toOptions(AUDIT_ACTION_LABEL)}
        />
        <SearchField
          label="Record id"
          placeholder="Order, product, coupon id…"
          value={filters.entityId}
          onSearch={(entityId) => {
            params.set({ entityId });
          }}
        />
      </FilterBar>

      <AdminQueryState
        query={log}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load the audit log"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<ScrollTextIcon className="size-6" strokeWidth={1.25} />}
            title="No entries match"
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Audit log" stale={log.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    When
                  </th>
                  <th scope="col" className={TH}>
                    Who
                  </th>
                  <th scope="col" className={TH}>
                    Action
                  </th>
                  <th scope="col" className={TH}>
                    Record
                  </th>
                  <th scope="col" className={TH}>
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((entry) => (
                  <tr key={entry.id} className={`${TBODY_ROW} align-top`}>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDateTime(entry.createdAt)}
                    </td>
                    <td className={TD}>
                      {entry.isSystem ? (
                        <span className="text-muted-foreground">System</span>
                      ) : (
                        <>
                          <span className="block">{entry.actor?.name ?? 'Deleted account'}</span>
                          <span className="block text-xs text-muted-foreground">
                            {entry.actorRole ? ROLE_LABEL[entry.actorRole] : null}
                            {entry.ipAddress ? ` · ${entry.ipAddress}` : null}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="block">{entry.entityType}</span>
                      {entry.entityId ? (
                        <button
                          type="button"
                          className={`font-mono text-xs text-muted-foreground underline underline-offset-4 ${focusRing}`}
                          onClick={() => {
                            params.set({ entityId: entry.entityId ?? undefined });
                          }}
                        >
                          {entry.entityId}
                        </button>
                      ) : null}
                    </td>
                    <td className={`${TD} max-w-md`}>
                      <ul className="flex flex-col gap-0.5 font-mono text-xs break-words">
                        {changes(entry).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="entries"
              one="entry"
            />
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
