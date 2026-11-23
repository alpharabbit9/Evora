import { cn } from '@/lib/utils';

/**
 * The layer a clip entrance wipes into view: inside a `BatchReveal effect="clip"`, GSAP takes
 * this element's `clip-path` from `inset(100% 0 0 0)` to `inset(0)`, so the photo rises into
 * its frame from the foot (plan.md Phase 5, ADR 0010). The clip is cleared when it lands, so
 * it never trims a hover effect afterwards.
 *
 * Ownership: GSAP owns `clip-path` on this element and nothing else. Hover movement (the card's
 * slow zoom) stays CSS on the image inside it. Outside a clip-mode `BatchReveal` it is a plain
 * wrapper and nothing animates it. Under reduced motion it is never clipped; the item fades.
 *
 * No hooks and no `'use client'`: Server and Client Components can both render it.
 */
export function ClipReveal({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-reveal="clip" className={cn('block', className)}>
      {children}
    </div>
  );
}
