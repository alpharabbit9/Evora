import { PackageOpenIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * "Nothing here" — an empty cart, a search with no matches, an order history that has not
 * started yet. A distinct state from loading and from failure, and it is where the next
 * useful action belongs (implementation-plan.md M1).
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: string;
  description?: string;
  /** Defaults to a neutral icon; pass one that matches the surface. */
  icon?: React.ReactNode;
  /** A button or link that moves the person forward ("Browse products"). */
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <div className="text-muted-foreground" aria-hidden="true">
        {icon ?? <PackageOpenIcon className="size-6" />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
