'use client';

import { UsersIcon } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  ADMIN_PAGE_SIZE,
  useAdminCustomers,
  useUpdateCustomerRole,
  useUpdateCustomerStatus,
  useViewer,
} from '@/lib/admin/api';
import {
  ROLE_LABEL,
  USER_STATUS_LABEL,
  type AdminCustomer,
  type UserRole,
  type UserStatus,
} from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  formatAdminDate,
  toOptions,
} from '../admin-ui';

const ROLES = Object.keys(ROLE_LABEL) as UserRole[];
const STATUSES = Object.keys(USER_STATUS_LABEL) as UserStatus[];

/**
 * Accounts, suspending one, and (for a superadmin) changing a role. The API refuses changes to
 * your own account and, below superadmin, to other administrators; its reason is shown as it gives
 * it. The role control is shown only to a superadmin, and the API checks that again whatever this
 * page shows (ADR 0009).
 */
export function CustomersList() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    role: params.getOneOf('role', ROLES),
    status: params.getOneOf('status', STATUSES),
  };
  const customers = useAdminCustomers(filters);
  const [target, setTarget] = useState<AdminCustomer | null>(null);
  const update = useUpdateCustomerStatus();
  const action = useAsyncAction(update.mutateAsync, {
    toastOnError: false,
    successMessage: (saved) =>
      saved.status === 'SUSPENDED'
        ? `${saved.email} is suspended and signed out everywhere.`
        : `${saved.email} can sign in again.`,
    onSuccess: () => {
      setTarget(null);
    },
  });
  const suspending = target?.status === 'ACTIVE';

  const viewer = useViewer();
  const canChangeRoles = viewer.data?.role === 'SUPERADMIN';
  const [roleChange, setRoleChange] = useState<{ customer: AdminCustomer; role: UserRole } | null>(
    null,
  );
  const updateRole = useUpdateCustomerRole();
  const roleAction = useAsyncAction(updateRole.mutateAsync, {
    toastOnError: false,
    successMessage: (saved) => `${saved.email} is now ${ROLE_LABEL[saved.role]}.`,
    onSuccess: () => {
      setRoleChange(null);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Customers"
        description="Suspending an account signs it out everywhere and stops it signing in."
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="Name or email"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="Role"
          value={filters.role}
          onChange={(role) => {
            params.set({ role });
          }}
          options={toOptions(ROLE_LABEL)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(status) => {
            params.set({ status });
          }}
          options={toOptions(USER_STATUS_LABEL)}
        />
      </FilterBar>

      <AdminQueryState
        query={customers}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load customers"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<UsersIcon className="size-6" strokeWidth={1.25} />}
            title="No accounts match"
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Customers" stale={customers.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Name
                  </th>
                  <th scope="col" className={TH}>
                    Email
                  </th>
                  <th scope="col" className={TH}>
                    Role
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Joined
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((customer) => (
                  <tr key={customer.id} className={TBODY_ROW}>
                    <td className={TD}>{customer.name}</td>
                    <td className={`${TD} max-w-64 truncate`} title={customer.email}>
                      {customer.email}
                      {customer.emailVerified ? null : (
                        <span className="block text-xs text-muted-foreground">Not verified</span>
                      )}
                    </td>
                    <td className={TD}>
                      {canChangeRoles && customer.id !== viewer.data?.id ? (
                        <NativeSelect
                          aria-label={`Role for ${customer.email}`}
                          value={customer.role}
                          className="h-8 w-36 text-xs"
                          onChange={(event) => {
                            roleAction.reset();
                            setRoleChange({ customer, role: event.target.value as UserRole });
                          }}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        ROLE_LABEL[customer.role]
                      )}
                    </td>
                    <td className={TD}>
                      <Badge tone={customer.status === 'ACTIVE' ? 'success' : 'destructive'}>
                        {USER_STATUS_LABEL[customer.status]}
                      </Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDate(customer.createdAt)}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={customer.status === 'ACTIVE' ? 'text-destructive' : undefined}
                        onClick={() => {
                          action.reset();
                          setTarget(customer);
                        }}
                      >
                        {customer.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        <span className="sr-only"> {customer.email}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="accounts"
            />
          </div>
        )}
      </AdminQueryState>

      <ConfirmDialog
        open={roleChange !== null}
        onOpenChange={(open) => {
          if (!open) setRoleChange(null);
        }}
        title={`Make ${roleChange?.customer.email ?? ''} ${roleChange ? ROLE_LABEL[roleChange.role] : ''}?`}
        description={
          roleChange?.role === 'CUSTOMER'
            ? 'They lose access to the dashboard at once.'
            : 'They can use the dashboard from their next request. The change is recorded in the audit log.'
        }
        confirmLabel="Change role"
        pendingLabel="Saving…"
        destructive={roleChange?.role === 'SUPERADMIN'}
        isPending={roleAction.isPending}
        error={roleAction.error}
        onConfirm={() => {
          if (roleChange) {
            void roleAction.run({ userId: roleChange.customer.id, role: roleChange.role });
          }
        }}
      />

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={
          suspending ? `Suspend ${target?.email ?? ''}?` : `Reactivate ${target?.email ?? ''}?`
        }
        description={
          suspending
            ? 'They are signed out everywhere at once and cannot sign in until reactivated. Their orders are kept.'
            : 'They can sign in and shop again.'
        }
        confirmLabel={suspending ? 'Suspend' : 'Reactivate'}
        pendingLabel="Saving…"
        destructive={suspending}
        isPending={action.isPending}
        error={action.error}
        onConfirm={() => {
          if (target) {
            void action.run({ userId: target.id, status: suspending ? 'SUSPENDED' : 'ACTIVE' });
          }
        }}
      />
    </div>
  );
}
