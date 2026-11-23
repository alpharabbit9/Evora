import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { visiblePolicyContent } from '@/lib/content-gates';
import { cn } from '@/lib/utils';

import { BENEFITS } from './benefits';

const HEADING_ID = 'service-strip-heading';

/** One `lg` column per promise shown; written out in full so Tailwind generates each class. */
const LG_COLUMNS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
};

/** `1` → `01`, in the strip's tabular figures. */
const figure = (n: number) => String(n).padStart(2, '0');

/**
 * The service strip: the store's promises as a quiet, numbered hairline index near the end of
 * the page, after the reviews and before the newsletter, instead of an icon band interrupting
 * the products. No icons: the words carry it.
 *
 * Phones: one compact row per promise. From `sm`, two columns; from `lg`, one row with as many
 * columns as there are promises, each separated by a hairline.
 *
 * Only promises backed by a decided policy are shown in a production build (ADR 0026), so the
 * row has as many columns as there are promises, and the heading's figure counts them. The copy
 * comes from `benefits.ts`, which the product page reads too, so the two cannot disagree.
 *
 * A Server Component: only the reveal wrapper runs in the browser. The items are not links and
 * have no hover state, so nothing suggests a click target that isn't there.
 *
 * Spacing: after the full-bleed reviews band (`data-band`) it adds the top padding a band needs;
 * after a framed section it starts on that section's own bottom padding.
 */
export function WhyShopWithUs() {
  const benefits = visiblePolicyContent(BENEFITS);
  if (benefits.length === 0) return null;

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="bg-background text-foreground [[data-band]+&]:pt-section-md"
    >
      <Container className="pb-section-lg">
        {/* `items={false}`: a static strip. Only the heading's mask and hairline move. */}
        <RevealGroup items={false}>
          <RevealItem>
            <SectionHeading
              variant="index"
              id={HEADING_ID}
              title="Shopping with EVORA"
              index={`${figure(benefits.length)} ${benefits.length === 1 ? 'promise' : 'promises'}`}
            />
          </RevealItem>

          <ol
            className={cn(
              'grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0',
              LG_COLUMNS[benefits.length] ?? 'lg:grid-cols-4',
            )}
          >
            {benefits.map(({ id, title, description }, index) => (
              <RevealItem
                key={id}
                as="li"
                className={cn(
                  'grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 py-5',
                  // Columns from `sm`: a hairline before every column but the first in its row.
                  'sm:border-border sm:py-6 sm:pr-8 sm:even:border-l sm:even:pl-8',
                  'lg:border-l lg:pl-8 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0',
                )}
              >
                <span
                  aria-hidden="true"
                  className="pt-0.5 font-mono text-xs text-muted-foreground tabular-nums"
                >
                  {figure(index + 1)}
                </span>
                <div className="min-w-0">
                  <h3 className="text-xs leading-5 font-semibold tracking-[0.18em] uppercase">
                    {title}
                  </h3>
                  <p className="mt-1 max-w-[38ch] text-sm leading-6 text-pretty text-muted-foreground">
                    {description}
                  </p>
                </div>
              </RevealItem>
            ))}
          </ol>
        </RevealGroup>
      </Container>
    </section>
  );
}
