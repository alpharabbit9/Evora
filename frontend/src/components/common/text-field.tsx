'use client';

import { useId } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

import { cn } from '@/lib/utils';

/**
 * A labelled input wired to react-hook-form, used by checkout and the account forms.
 *
 * The message line under the input is the error when there is one, otherwise the hint. It is
 * referenced by `aria-describedby`, so a screen reader hears it with the field, and the server's
 * verdict lands here too: a form copies the API's `details` onto fields with `setError`.
 */
export function TextField({
  label,
  registration,
  error,
  hint,
  className,
  type = 'text',
  autoComplete,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string | undefined;
  hint?: string;
  className?: string;
  type?: string;
  autoComplete?: string;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className="h-11 w-full min-w-0 border border-input bg-transparent px-3 text-sm transition-colors outline-none hover:border-foreground/50 focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive"
        {...registration}
      />
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
