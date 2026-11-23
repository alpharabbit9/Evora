'use client';

import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';

import { QueryState } from '@/components/common/query-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { ListParams } from '@/lib/admin/use-list-params';
import { ApiErrorCode, errorMessage, isApiError } from '@/lib/api-error';
import { signInPath } from '@/lib/safe-redirect';
import { cn } from '@/lib/utils';

/**
 * The pieces every admin screen repeats, so they all have the same loading, empty, error and
 * success states (implementation-plan.md, definition of done).
 */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export const TH = 'px-3 py-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground';
export const TD = 'px-3 py-2.5 align-middle';
export const THEAD_ROW = 'border-b border-border';
export const TBODY_ROW = 'border-b border-border last:border-b-0';

export function AdminPageHeader({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className={cn(
            'inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground',
            focusRing,
          )}
        >
          <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold break-words">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}

/** `QueryState`, plus the one state only a long-lived dashboard hits: the session ran out. */
export function AdminQueryState<TData>(props: React.ComponentProps<typeof QueryState<TData>>) {
  const pathname = usePathname();
  const { query } = props;

  if (
    query.isError &&
    isApiError(query.error) &&
    query.error.code === ApiErrorCode.UNAUTHENTICATED
  ) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">Your session has ended.</p>
        <Link href={signInPath(pathname)} className={buttonVariants({ variant: 'outline' })}>
          Sign in again
        </Link>
      </div>
    );
  }

  return <QueryState {...props} />;
}

export function TableFrame({
  children,
  label,
  stale = false,
}: {
  children: React.ReactNode;
  /** Names the scrollable region for assistive technology. */
  label: string;
  /** The previous page, still on screen while the next one loads. */
  stale?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={stale}
      tabIndex={0}
      // `relative` contains the `sr-only` labels in row buttons: they are absolutely positioned,
      // and without a positioned ancestor they escape the scroll box and widen the whole page.
      className={cn(
        'relative overflow-x-auto rounded-lg border border-border bg-card',
        focusRing,
        stale && 'opacity-60',
      )}
    >
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

const BADGE_TONE = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  destructive: 'bg-destructive/10 text-destructive',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof BADGE_TONE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onSearch,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [applied, setApplied] = useState(value);

  // The URL changed without this field: Back, or a link that clears the filters.
  if (applied !== value) {
    setApplied(value);
    setDraft(value ?? '');
  }

  return (
    <form
      role="search"
      className="flex w-full flex-col gap-1.5 sm:max-w-xs"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim() || undefined);
      }}
    >
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          type="search"
          value={draft}
          maxLength={120}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" variant="outline" size="icon" aria-label={`Search: ${label}`}>
          <SearchIcon aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-44">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <NativeSelect
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value || undefined);
        }}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

/** Turns a label map into the options a `FilterSelect` or form select lists. */
export function toOptions<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}

export function AdminPagination({
  params,
  pageSize,
  total,
  noun,
  one,
}: {
  params: ListParams;
  pageSize: number;
  total: number;
  /** Plural, as the count reads: "products". */
  noun: string;
  /** Singular, for a count of one: "product". Defaults to `noun` without its final "s". */
  one?: string;
}) {
  const { page } = params;
  const counted = total === 1 ? (one ?? noun.replace(/s$/, '')) : noun;
  const last = Math.max(1, Math.ceil(total / pageSize));

  const step = (target: number, label: string, icon: React.ReactNode) =>
    target < 1 || target > last ? (
      <span
        aria-disabled="true"
        className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }), 'opacity-50')}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </span>
    ) : (
      <Link
        href={params.hrefWith({ page: target === 1 ? undefined : target })}
        scroll={false}
        aria-label={label}
        className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
      >
        {icon}
      </Link>
    );

  return (
    <nav
      aria-label={`Pages of ${noun}`}
      className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <p aria-live="polite">
        {total.toLocaleString('en-US')} {counted} · page {page.toLocaleString('en-US')} of{' '}
        {last.toLocaleString('en-US')}
      </p>
      <div className="flex items-center gap-1.5">
        {step(page - 1, 'Previous page', <ChevronLeftIcon aria-hidden="true" />)}
        {step(page + 1, 'Next page', <ChevronRightIcon aria-hidden="true" />)}
      </div>
    </nav>
  );
}

/**
 * The API's own words where it refused something on purpose ("You cannot change your own account
 * status"): they say why, and `errorMessage` would flatten a 403 to generic copy.
 */
export function adminErrorMessage(error: unknown): string {
  return isApiError(error) && error.code === ApiErrorCode.FORBIDDEN
    ? error.message
    : errorMessage(error);
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;

  const requestId = isApiError(error) ? error.requestId : undefined;
  // The API's reasons per field ("slug: Must be a lowercase hyphenated slug"), so a refused form
  // says what to fix instead of only that something was wrong.
  const details = isApiError(error) ? error.details : [];

  return (
    <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p>{adminErrorMessage(error)}</p>
      {details.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {details.map((detail) => (
            <li key={`${detail.field}:${detail.issue}`}>
              {detail.field}: {detail.issue}
            </li>
          ))}
        </ul>
      ) : null}
      {requestId ? (
        <p className="mt-1 font-mono text-xs opacity-80">Reference: {requestId}</p>
      ) : null}
    </div>
  );
}

/** A label, a control and its hint or error, wired together for assistive technology. */
export function FormField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  className?: string;
  children: (control: {
    id: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })}
      {message ? (
        <p
          id={messageId}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Cancel and submit for a dialog's form; leaving is blocked while the write is in flight. */
export function FormActions({
  isPending,
  submitLabel,
  pendingLabel,
  onCancel,
}: {
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isPending}>
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}

/** Asks before something that takes effect at once and is awkward to undo. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  isPending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  isPending: boolean;
  error?: unknown;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Leaving while the write is in flight would hide whether it worked.
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function formatAdminDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatAdminDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatOptions(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
}

/** Puts the API's per-field verdicts onto a react-hook-form; true if any landed on a field. */
export function applyFieldErrors(
  error: unknown,
  setFieldError: (field: string, message: string) => void,
): boolean {
  if (!isApiError(error)) return false;

  for (const detail of error.details) {
    setFieldError(detail.field, detail.issue);
  }

  return error.details.length > 0;
}
