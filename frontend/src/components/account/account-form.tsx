'use client';

import type { FieldValues, Path, UseFormSetError, UseFormSetFocus } from 'react-hook-form';

import { isApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

/** The account page's own buttons, in the checkout form's style. */
export const PRIMARY_BUTTON =
  'inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40';

export const SECONDARY_BUTTON =
  'inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-medium transition-colors hover:border-foreground/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40';

export const TEXT_BUTTON =
  'rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Copies the API's validation `details` onto the form's fields and focuses the first one. Only
 * fields the form actually has are touched; the caller shows anything left over as a form-level
 * message. Returns whether any field took an error.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
  setFocus: UseFormSetFocus<T>,
): boolean {
  if (!isApiError(error)) return false;

  let applied = false;

  for (const detail of error.details) {
    const field = fields.find((candidate) => candidate === detail.field);
    if (!field) continue;

    setError(field, { type: 'server', message: detail.issue });
    if (!applied) setFocus(field);
    applied = true;
  }

  return applied;
}

/**
 * An account section's title: Playfair, like every other section title in the store. It is the
 * target of the page's section index, so it stops below the sticky header.
 */
export const ACCOUNT_SECTION_TITLE =
  'scroll-mt-28 font-heading text-2xl leading-snug font-normal tracking-[-0.005em]';

/** An account section: a heading, an optional line under it, and its content. */
export function AccountSection({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-col gap-4 border-t border-border pt-8', className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={id} className={ACCOUNT_SECTION_TITLE}>
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Always mounted, so a screen reader hears each new failure when it appears. */
export function FormAlert({ message }: { message: string | undefined }) {
  return (
    <div role="alert" className="text-sm text-destructive empty:hidden">
      {message ? <p>{message}</p> : null}
    </div>
  );
}
