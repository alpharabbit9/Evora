import { cn } from '@/lib/utils';

/**
 * The storefront's page width and side gutters: capped at 1680px, with gutters that grow at
 * `sm`, `lg` and `xl`. The header, the home page sections and the footer all line up on it.
 * Vertical spacing is the caller's (`pt-section-*` / `pb-section-*`, defined in `globals.css`).
 *
 * `CONTAINER` is the same classes for elements that cannot be this component (a grid row, a
 * `<nav>`), so the values live in one place.
 */
export const CONTAINER = 'mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-10 xl:px-14';

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn(CONTAINER, className)}>{children}</div>;
}
