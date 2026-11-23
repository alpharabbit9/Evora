import { cn } from '@/lib/utils';

import { RevealLine, RevealRule } from './reveal';

type SharedProps = {
  /** Put on the `<h2>`, so the section can name itself with `aria-labelledby`. */
  id: string;
  title: string;
  className?: string;
};

type SectionHeadingProps = SharedProps &
  (
    | {
        /** The chapter opener: a small ruled eyebrow over a large Playfair title. */
        variant?: 'editorial';
        eyebrow: string;
      }
    | {
        /**
         * One line for product sections: the section's name in Playfair, an optional italic
         * aside after it, then a hairline running out to the section's action (a link).
         */
        variant: 'inline';
        aside?: string;
        action?: React.ReactNode;
      }
    | {
        /**
         * A compact title over a hairline, with a tabular figure at the far end (for example
         * how many entries follow). For index-like content: the service strip.
         */
        variant: 'index';
        index?: string;
      }
  );

/** The editorial eyebrow: small tracked capitals in the muted ink. */
const EYEBROW = 'text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase';

/**
 * The home page's section openers, in three archetypes, so the page's chapters stop opening the
 * same way (plan.md §D "Layout principles"):
 *
 * - `editorial` (default): a ruled eyebrow over a Playfair title at display size.
 * - `inline`: the name, an aside and the section's link on one line, for product sections.
 * - `index`: a smaller title over a hairline, with a Geist Mono figure at the end.
 *
 * Colour comes from the section (`currentColor` and `muted-foreground`), so every archetype works
 * on any light or dark surface the theme provides. Inside a `RevealItem`, rules draw in and
 * titles rise out of a mask as the section reveals; anywhere else they render in place.
 */
export function SectionHeading(props: SectionHeadingProps) {
  const { id, title, className } = props;

  if (props.variant === 'inline') {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-8 gap-y-4', className)}>
        <h2
          id={id}
          className="font-heading text-[clamp(1.75rem,1.45rem+1.1vw,2.5rem)] leading-[1.1] font-normal tracking-[-0.015em] text-balance"
        >
          <RevealLine>
            {title}
            {props.aside ? (
              <span className="text-muted-foreground italic">, {props.aside}</span>
            ) : null}
          </RevealLine>
        </h2>
        {/* The rule runs from the title to the action, so the row reads as one line. */}
        <RevealRule className="hidden h-px min-w-12 flex-1 bg-current opacity-25 sm:block" />
        {props.action}
      </div>
    );
  }

  if (props.variant === 'index') {
    return (
      <div
        className={cn(
          'flex items-baseline justify-between gap-6 border-b border-current/20 pb-4',
          className,
        )}
      >
        <h2
          id={id}
          className="font-heading text-[clamp(1.375rem,1.2rem+0.6vw,1.75rem)] leading-tight font-normal tracking-[-0.01em]"
        >
          <RevealLine>{title}</RevealLine>
        </h2>
        {props.index ? (
          <span aria-hidden="true" className="font-mono text-xs text-muted-foreground tabular-nums">
            {props.index}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <p className={cn('flex items-center gap-3', EYEBROW)}>
        <RevealRule className="h-px w-8 bg-current opacity-60" />
        {props.eyebrow}
      </p>
      <h2
        id={id}
        className="mt-5 font-heading text-[clamp(2rem,1.55rem+1.6vw,3rem)] leading-[1.08] font-normal tracking-[-0.015em] text-balance"
      >
        <RevealLine>{title}</RevealLine>
      </h2>
    </div>
  );
}
