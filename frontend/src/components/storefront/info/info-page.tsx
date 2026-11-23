import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';
import { SectionIndex } from '@/components/layout/section-index';
import { ENTER } from '@/lib/motion/enter';
import { cn } from '@/lib/utils';

const FRAME = 'mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-10 xl:px-14';

/** Every help and legal page, for the index beside each of them. */
const HELP_PAGES = [
  { key: 'faq', href: '/faq', label: 'FAQ' },
  { key: 'shipping', href: '/shipping', label: 'Shipping & returns' },
  { key: 'privacy', href: '/privacy', label: 'Privacy' },
  { key: 'terms', href: '/terms', label: 'Terms' },
] as const;

export type HelpPageKey = (typeof HELP_PAGES)[number]['key'];

/**
 * Frame for the plain-text help and legal pages (`/faq`, `/shipping`, `/privacy`, `/terms`):
 * the store's `PageHeader` with an optional draft notice, then the body in a reading-width
 * column. From `lg`, the column beside it holds a sticky index: the page's own sections
 * (`contents`), when it has more than one, and the help pages (pages-plan.md P3). Below `lg`
 * the index follows the body.
 *
 * Entrance: the header's CSS entrance, then the body and index fade up just after it. Reduced
 * motion: none.
 *
 * A Server Component with static content, so each page is part of the prerendered shell.
 * `draft` renders the notice that these pages must carry while the policy behind them is
 * undecided (PRD §9): nothing on them may read as a final commitment.
 */
export function InfoPage({
  page,
  eyebrow,
  title,
  description,
  draft,
  contents,
  children,
}: {
  /** Which help page this is, so the index can mark it. */
  page: HelpPageKey;
  eyebrow: string;
  title: string;
  description?: string;
  /** What is still undecided; shown as a notice under the heading. Omit once confirmed. */
  draft?: string;
  /** The page's sections, by `InfoSection` id, for the "On this page" index. */
  contents?: readonly { id: string; title: string }[];
  children: React.ReactNode;
}) {
  return (
    <PageTransition>
      <div className={`${FRAME} pt-10 pb-20 sm:pt-14 sm:pb-28`}>
        <PageHeader eyebrow={eyebrow} title={title} description={description}>
          {draft ? <DraftNotice>{draft}</DraftNotice> : null}
        </PageHeader>

        <div
          className={cn(
            ENTER,
            'mt-12 grid gap-16 delay-[450ms] slide-in-from-bottom-3 sm:mt-16',
            'lg:grid-cols-[minmax(0,68ch)_minmax(13rem,18rem)] lg:justify-between lg:gap-20',
          )}
        >
          <div className="min-w-0">{children}</div>
          <aside className="flex flex-col gap-10 lg:sticky lg:top-28 lg:self-start">
            {contents && contents.length > 1 ? (
              <SectionIndex
                label="On this page"
                numbered
                items={contents.map((item) => ({ href: `#${item.id}`, label: item.title }))}
              />
            ) : null}
            <SectionIndex
              label="Help"
              items={HELP_PAGES.map((item) => ({
                href: item.href,
                label: item.label,
                current: item.key === page,
              }))}
            />
          </aside>
        </div>
      </div>
    </PageTransition>
  );
}

/** A labelled notice for content that is not final. */
export function DraftNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="note"
      className="mt-6 max-w-2xl border-l-2 border-foreground/50 pl-4 text-xs leading-5 text-muted-foreground"
    >
      <p className="text-[10px] font-semibold tracking-[0.2em] text-foreground uppercase">Draft</p>
      <p className="mt-1.5">{children}</p>
    </div>
  );
}

/** One titled block of body text. `id` makes it linkable. */
export function InfoSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="mt-12 scroll-mt-28 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
    >
      <h2 id={headingId} className="font-heading text-2xl leading-snug tracking-[-0.005em]">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-7 text-muted-foreground sm:text-[15px]">
        {children}
      </div>
    </section>
  );
}
