'use client';

import { TriangleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

/**
 * The shared failure state. It takes the raw thrown value rather than a string, so no
 * caller has to decide what is safe to render: `errorMessage` keeps internals out of the
 * UI, and the request id is shown when the API sent one so a support report can be traced
 * back to the server logs (API_SPEC.md §1).
 */
export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  retryLabel = 'Try again',
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const requestId = isApiError(error) ? error.requestId : undefined;

  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <TriangleAlertIcon className="size-6 text-destructive" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
      {requestId ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {requestId}</p>
      ) : null}
    </div>
  );
}
