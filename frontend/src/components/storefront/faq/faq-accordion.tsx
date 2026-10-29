'use client';

import { useId, useState } from 'react';

import { RevealItem } from '@/components/storefront/reveal';
import { cn } from '@/lib/utils';

import type { Faq } from './faqs';

/**
 * The FAQ list: one answer open at a time, the first open to start with, so the pattern is
 * visible before anyone clicks. Clicking the open question closes it.
 *
 * Follows the WAI-ARIA accordion pattern: each trigger is a native button inside a heading,
 * with `aria-expanded` and `aria-controls`, and each panel is a region named by its trigger.
 * Buttons give Tab, Enter and Space for free; no roving focus is needed for four items.
 *
 * Panels stay mounted, so `aria-controls` always points at something. A closed panel is
 * collapsed with the `grid-template-rows: 0fr` technique (the browser animates to the
 * content's real height, no measuring) and made `inert`, which takes its text out of the tab
 * order and the accessibility tree. Reduced motion drops the transitions; the state change
 * itself is instant either way.
 */
export function FaqAccordion({ faqs }: { faqs: readonly Faq[] }) {
  const baseId = useId();
  const [openId, setOpenId] = useState<string | null>(faqs[0]?.id ?? null);

  return (
    <div className="border-b border-border">
      {faqs.map((faq) => {
        const open = faq.id === openId;
        const buttonId = `${baseId}-${faq.id}-trigger`;
        const panelId = `${baseId}-${faq.id}-panel`;

        return (
          // Framer owns this wrapper's opacity and transform (the entrance); the panel's
          // own transitions are CSS on elements inside it.
          <RevealItem key={faq.id} className="border-t border-border">
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : faq.id)}
                className="group flex w-full items-center justify-between gap-6 py-6 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:py-7"
              >
                <span className="font-heading text-[clamp(1.0625rem,1rem+0.35vw,1.3125rem)] leading-snug text-pretty transition-colors group-hover:text-foreground/70">
                  {faq.question}
                </span>
                <PlusMinus open={open} />
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!open}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
                open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                {/* Padding sits inside the clipped box, so the collapsed row is truly 0px. */}
                <div className="max-w-[62ch] pr-10 pb-7 text-sm leading-7 break-words text-muted-foreground sm:text-[15px]">
                  {faq.answer.map((paragraph) => (
                    <p key={paragraph} className="mt-3 first:mt-0">
                      {paragraph}
                    </p>
                  ))}
                  {faq.policy === 'placeholder' ? (
                    <p className="mt-4 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                      Placeholder — policy to be confirmed
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </RevealItem>
        );
      })}
    </div>
  );
}

/**
 * A thin plus whose vertical stroke turns flat when open, leaving a minus. Decorative: the
 * button's `aria-expanded` carries the state.
 */
function PlusMinus({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="relative size-4 shrink-0">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-current" />
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-current transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
          open && 'rotate-90',
        )}
      />
    </span>
  );
}
