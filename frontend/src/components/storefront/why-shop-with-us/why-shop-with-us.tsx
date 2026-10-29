import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { cn } from '@/lib/utils';

import { BENEFITS } from './benefits';

const HEADING_ID = 'why-shop-with-us-heading';

/**
 * Phones: one column, icon beside the text. From `sm`, the icon sits above, and each item is
 * a three-row subgrid (icon, title, description) of the list, so a title that wraps to two
 * lines pushes every column's description down with it and they stay level.
 *
 * Hairlines between the benefits, per layout. The list's own `divide-y` separates the rows
 * of the single column on phones; from `sm` each item draws its own rules instead:
 *
 * - `sm` (2 × 2): a vertical rule before the right-hand column and a horizontal one above the
 *   second row. The first row's bottom padding sits above that rule, so the vertical rules
 *   run through it unbroken.
 * - `lg` (4 × 1): a vertical rule before every item but the first; no horizontal rules.
 */
const ITEM_LAYOUT = cn(
  'flex items-start gap-5 py-6 first:pt-0 last:pb-0',
  'sm:row-span-3 sm:grid sm:grid-rows-subgrid sm:gap-0',
  'sm:py-0 sm:odd:pr-8 sm:even:border-l sm:even:pl-8',
  'sm:nth-[-n+2]:pb-9 sm:nth-[n+3]:border-t sm:nth-[n+3]:pt-9',
  'lg:border-l lg:px-8 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0',
  'lg:nth-[-n+2]:pb-0 lg:nth-[n+3]:border-t-0 lg:nth-[n+3]:pt-0',
);

/**
 * Trust band under the home hero: the reasons to buy here, as four quiet columns behind a
 * small editorial heading. The heading sits above the list up to `xl`, and beside it from
 * there, where the four columns still have room to read.
 *
 * A Server Component: only the reveal wrapper runs in the browser. The items are not links
 * and have no hover state, so nothing suggests a click target that isn't there.
 */
export function WhyShopWithUs() {
  return (
    <section aria-labelledby={HEADING_ID} className="bg-background text-foreground">
      {/* Less room above than below: the top rule is what hands over from the hero. */}
      <div className="mx-auto w-full max-w-[1680px] px-4 pt-[clamp(2rem,1rem+3vw,4rem)] pb-[clamp(3.5rem,2.5rem+4vw,6.5rem)] sm:px-6 lg:px-10 xl:px-14">
        <RevealGroup className="grid gap-10 border-t border-border pt-10 sm:gap-12 sm:pt-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.6fr)] xl:gap-0 xl:pt-14">
          <RevealItem className="xl:pr-12">
            <SectionHeading
              id={HEADING_ID}
              eyebrow="Why shop with us?"
              title="More Than Just Fashion"
            />
          </RevealItem>

          <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
            {BENEFITS.map(({ id, title, description, icon: Icon }) => (
              <RevealItem key={id} as="li" className={ITEM_LAYOUT}>
                <Icon
                  aria-hidden="true"
                  strokeWidth={1.25}
                  className="mt-0.5 size-6 shrink-0 sm:mt-0 sm:mb-5 sm:size-7"
                />
                {/* A box for the phone row; from `sm` its title and text join the subgrid. */}
                <div className="min-w-0 sm:contents">
                  <h3 className="text-xs leading-5 font-semibold tracking-[0.18em] uppercase">
                    {title}
                  </h3>
                  <p className="mt-2 max-w-[34ch] text-sm leading-6 text-pretty text-muted-foreground">
                    {description}
                  </p>
                </div>
              </RevealItem>
            ))}
          </ul>
        </RevealGroup>
      </div>
    </section>
  );
}
