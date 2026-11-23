import { Skeleton } from '@/components/ui/skeleton';
import { ENTER, ENTER_MASK } from '@/lib/motion/enter';
import { cn } from '@/lib/utils';

const EYEBROW =
  'flex items-center gap-3 text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase';

/** The inner pages' title size: one step under the collection banner's. */
export const PAGE_TITLE =
  'font-heading text-[clamp(2.2rem,1.6rem+2.2vw,3.5rem)] leading-[1.04] font-normal tracking-[-0.015em] text-balance';

/**
 * The opener of every inner store page (the bag, checkout, an order, the wishlist, the account,
 * search and the help pages): a ruled eyebrow, a Playfair title and an optional line of copy,
 * then anything the page adds under it (a search box, a notice). One opener, so the store's
 * pages stop each starting their own way (pages-plan.md P1).
 *
 * Entrance (CSS, `lib/motion/enter.ts`): the eyebrow fades up, the title rises out of its mask
 * just behind, then the copy and the extras. It plays from the first paint, so the `<h1>` never
 * waits on hydration, and the server HTML is the finished header. Reduced motion: no entrance.
 *
 * A Server Component; it ships no JavaScript.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={className}>
      <p className={cn(ENTER, EYEBROW, 'delay-100 slide-in-from-bottom-2')}>
        <span aria-hidden="true" className="h-px w-8 bg-current opacity-60" />
        {eyebrow}
      </p>
      <h1 className={cn('mt-5', ENTER_MASK, PAGE_TITLE)}>
        <span className={cn(ENTER, 'block delay-150 slide-in-from-bottom-full')}>{title}</span>
      </h1>
      {description ? (
        <p
          className={cn(
            ENTER,
            'mt-4 max-w-xl text-sm leading-7 text-muted-foreground delay-300 slide-in-from-bottom-3',
          )}
        >
          {description}
        </p>
      ) : null}
      {children ? (
        <div className={cn(ENTER, 'delay-300 slide-in-from-bottom-3')}>{children}</div>
      ) : null}
    </header>
  );
}

/** The header's eyebrow and title footprint, for a route still loading. */
export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-5 h-[clamp(2.2rem,1.6rem+2.2vw,3.5rem)] w-56 max-w-full" />
    </div>
  );
}
