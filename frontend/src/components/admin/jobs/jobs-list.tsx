'use client';

import { MailIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  ADMIN_PAGE_SIZE,
  useAdminJobSummary,
  useAdminJobs,
  useRetryDeadJobs,
  useRetryJob,
} from '@/lib/admin/api';
import {
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  type AdminJob,
  type AdminJobSummary,
  type JobStatus,
  type JobType,
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
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
  toOptions,
} from '../admin-ui';

const STATUSES = Object.keys(JOB_STATUS_LABEL) as JobStatus[];
const TYPES = Object.keys(JOB_TYPE_LABEL) as JobType[];

const STATUS_TONE: Record<JobStatus, 'neutral' | 'success' | 'warning' | 'destructive'> = {
  PENDING: 'neutral',
  PROCESSING: 'neutral',
  SENT: 'success',
  FAILED: 'warning',
  DEAD: 'destructive',
};

/** A due job older than this means the worker is probably not running. */
const STALLED_AFTER_MS = 5 * 60 * 1000;

/**
 * The outbox (ADR 0021): every email and background job, what happened to it, and a retry for
 * the ones that gave up. The API never returns a job's contents, only what it is about, so a
 * reset link cannot be read from here. Retrying is audited.
 */
export function JobsList() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    status: params.getOneOf('status', STATUSES),
    type: params.getOneOf('type', TYPES),
  };
  const jobs = useAdminJobs(filters);
  const summary = useAdminJobSummary();

  const [target, setTarget] = useState<AdminJob | null>(null);
  const retry = useRetryJob();
  const retryOne = useAsyncAction(retry.mutateAsync, {
    toastOnError: false,
    successMessage: (job) => `${JOB_TYPE_LABEL[job.eventType]} will be tried again shortly.`,
    onSuccess: () => {
      setTarget(null);
    },
  });

  const [bulkOpen, setBulkOpen] = useState(false);
  const retryAll = useRetryDeadJobs();
  const retryDead = useAsyncAction(retryAll.mutateAsync, {
    toastOnError: false,
    successMessage: ({ retried, remaining }) =>
      remaining > 0
        ? `${String(retried)} jobs queued again. ${String(remaining)} more remain: run it again.`
        : `${String(retried)} jobs queued again.`,
    onSuccess: () => {
      setBulkOpen(false);
    },
  });

  const deadCount = summary.data?.retryableDead ?? 0;
  const bulkScope = filters.type ? JOB_TYPE_LABEL[filters.type].toLowerCase() : 'job';

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Emails & jobs"
        description="Receipts, shipping and refund emails, staff alerts and the payment sweep. Each is retried on its own for about an hour; one that gives up waits here for you."
        action={
          deadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                retryDead.reset();
                setBulkOpen(true);
              }}
            >
              Retry all that gave up
            </Button>
          ) : null
        }
      />

      {summary.data ? <SummaryPanel summary={summary.data} /> : null}

      <FilterBar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(status) => {
            params.set({ status });
          }}
          options={toOptions(JOB_STATUS_LABEL)}
        />
        <FilterSelect
          label="Kind"
          value={filters.type}
          onChange={(type) => {
            params.set({ type });
          }}
          options={toOptions(JOB_TYPE_LABEL)}
        />
      </FilterBar>

      <AdminQueryState
        query={jobs}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load jobs"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<MailIcon className="size-6" strokeWidth={1.25} />}
            title={filters.status || filters.type ? 'No jobs match' : 'Nothing has been queued yet'}
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Jobs" stale={jobs.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Kind
                  </th>
                  <th scope="col" className={TH}>
                    About
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Tries
                  </th>
                  <th scope="col" className={TH}>
                    When
                  </th>
                  <th scope="col" className={TH}>
                    Last error
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((job) => (
                  <tr key={job.id} className={TBODY_ROW}>
                    <td className={`${TD} whitespace-nowrap`}>{JOB_TYPE_LABEL[job.eventType]}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <JobSubjectCell job={job} />
                    </td>
                    <td className={TD}>
                      <Badge tone={STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground tabular-nums`}>
                      {job.maxAttempts === null
                        ? String(job.attemptCount)
                        : `${String(job.attemptCount)} / ${String(job.maxAttempts)}`}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      <WhenCell job={job} />
                    </td>
                    <td
                      className={`${TD} max-w-72 truncate text-xs text-muted-foreground`}
                      title={job.lastError ?? undefined}
                    >
                      {job.lastError ?? '—'}
                    </td>
                    <td className={`${TD} text-right`}>
                      {job.retryable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            retryOne.reset();
                            setTarget(job);
                          }}
                        >
                          Retry
                          <span className="sr-only"> {JOB_TYPE_LABEL[job.eventType]}</span>
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="jobs"
            />
          </div>
        )}
      </AdminQueryState>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={`Retry this ${target ? JOB_TYPE_LABEL[target.eventType].toLowerCase() : 'job'}?`}
        description={
          target?.recurring
            ? 'It runs again at once instead of waiting for its next turn.'
            : 'It is tried again within a few seconds, with a fresh set of tries. If it was an email, the recipient may already have it: retrying can send it twice.'
        }
        confirmLabel="Retry"
        pendingLabel="Queuing…"
        isPending={retryOne.isPending}
        error={retryOne.error}
        onConfirm={() => {
          if (target) void retryOne.run(target.id);
        }}
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Retry every ${bulkScope} that gave up?`}
        description="Do this once whatever stopped them (an email outage, a wrong setting) is fixed. Up to 500 are queued at a time; account emails whose link has expired cannot be sent again."
        confirmLabel="Retry all"
        pendingLabel="Queuing…"
        isPending={retryDead.isPending}
        error={retryDead.error}
        onConfirm={() => {
          void retryDead.run(filters.type ? { type: filters.type } : {});
        }}
      />
    </div>
  );
}

function SummaryPanel({ summary }: { summary: AdminJobSummary }) {
  // Read once per render; the summary refreshes every few seconds, which re-renders this.
  const [now] = useState(() => Date.now());
  const stalled =
    summary.oldestDueAt !== null &&
    now - new Date(summary.oldestDueAt).getTime() > STALLED_AFTER_MS;
  const sweep = summary.reconciliation;

  const tiles: { label: string; value: number; tone?: 'warning' | 'destructive' }[] = [
    { label: 'Due now', value: summary.due, ...(stalled ? { tone: 'warning' as const } : {}) },
    { label: 'Retrying', value: summary.counts.FAILED },
    {
      label: 'Gave up',
      value: summary.counts.DEAD,
      ...(summary.counts.DEAD > 0 ? { tone: 'destructive' as const } : {}),
    },
    { label: 'Done', value: summary.counts.SENT },
  ];

  return (
    <section aria-label="Queue summary" className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd
              className={
                tile.tone === 'destructive'
                  ? 'text-2xl font-medium text-destructive tabular-nums'
                  : tile.tone === 'warning'
                    ? 'text-2xl font-medium text-amber-700 tabular-nums dark:text-amber-300'
                    : 'text-2xl font-medium tabular-nums'
              }
            >
              {tile.value.toLocaleString('en-US')}
            </dd>
          </div>
        ))}
      </dl>

      {stalled && summary.oldestDueAt ? (
        <p
          role="status"
          className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
        >
          Jobs have been waiting since {formatAdminDateTime(summary.oldestDueAt)}. Check that the
          worker is running (<code className="font-mono text-xs">npm run worker</code>).
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {sweep === null ? (
          'The payment sweep has not been scheduled yet: it is created when the worker first starts.'
        ) : (
          <>
            Payment sweep:{' '}
            {sweep.lastRunAt ? `last ran ${formatAdminDateTime(sweep.lastRunAt)}` : 'not run yet'}
            {sweep.status === 'PROCESSING'
              ? ', running now.'
              : `, next ${formatAdminDateTime(sweep.nextRunAt)}.`}
            {sweep.failingRuns > 0 ? (
              <span className="text-destructive">
                {' '}
                The last {String(sweep.failingRuns)} runs failed
                {sweep.lastError ? `: ${sweep.lastError}` : '.'}
              </span>
            ) : null}
          </>
        )}
      </p>
    </section>
  );
}

function JobSubjectCell({ job }: { job: AdminJob }) {
  const { orderId, orderNumber, sku } = job.subject;

  if (orderId) {
    return (
      <Link
        href={`/admin/orders/${encodeURIComponent(orderId)}`}
        className={`underline underline-offset-4 hover:text-foreground ${focusRing}`}
      >
        {orderNumber ?? 'Order'}
      </Link>
    );
  }

  if (sku) return <span className="font-mono text-xs">{sku}</span>;
  if (job.recurring) return <span className="text-muted-foreground">Every few minutes</span>;
  if (job.eventType === 'PASSWORD_RESET' || job.eventType === 'EMAIL_VERIFICATION') {
    return <span className="text-muted-foreground">An account</span>;
  }

  return <span className="text-muted-foreground">—</span>;
}

function WhenCell({ job }: { job: AdminJob }) {
  if (job.status === 'SENT' && job.processedAt) {
    return <>Done {formatAdminDateTime(job.processedAt)}</>;
  }
  if (job.status === 'DEAD') return <>Gave up {formatAdminDateTime(job.updatedAt)}</>;
  if (job.status === 'PROCESSING') return <>Running</>;
  if (job.nextAttemptAt) return <>Next {formatAdminDateTime(job.nextAttemptAt)}</>;
  return <>Queued {formatAdminDateTime(job.createdAt)}</>;
}
