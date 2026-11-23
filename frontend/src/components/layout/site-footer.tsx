import Link from 'next/link';

import { cn } from '@/lib/utils';

import { AccountLinks } from './account-links';
import { Container } from './container';
import { FooterWordmark } from './footer-wordmark';
import { HELP_LINKS, NEW_ARRIVALS_LINK, type NavLink, SHOP_LINKS } from './nav-links';

/**
 * The link columns. "Account" is `null` here and rendered by `AccountLinks`, a client island,
 * because what it offers depends on whether the visitor is signed in. Every href comes from
 * `nav-links.ts`, the same lists the header uses.
 */
const FOOTER_GROUPS: readonly { title: string; links: readonly NavLink[] | null }[] = [
  { title: 'Shop', links: [NEW_ARRIVALS_LINK, ...SHOP_LINKS] },
  { title: 'Account', links: null },
  { title: 'Help', links: HELP_LINKS },
];

const LEGAL_LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ivory';

// On touch screens each link is a 44px row, and at least 44px wide to the finger (plan.md
// Phase 8), so the list drops its gaps.
const FOOTER_LINK = cn(
  'text-sm text-sand-400 transition-colors hover:text-ivory pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:tap-target',
  focusRing,
);
const FOOTER_LIST = 'mt-4 space-y-3 pointer-coarse:mt-1.5 pointer-coarse:space-y-0';

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-charcoal text-ivory">
      <Container className="pt-14 pb-7 sm:pt-16 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_2fr] lg:gap-20">
          <div>
            <p className="max-w-sm text-lg leading-7 text-balance sm:text-xl sm:leading-8">
              Considered clothing and objects for a slower, more deliberate everyday.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-sand-400">
              Designed to be worn, kept, and returned to.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="text-[10px] font-semibold tracking-[0.22em] uppercase">
                  {group.title}
                </h2>
                {group.links ? (
                  <ul className={FOOTER_LIST}>
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className={FOOTER_LINK}>
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <AccountLinks className={FOOTER_LIST} linkClassName={FOOTER_LINK} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sized against this row's width (cqw), not the viewport's, so it fills the row at
            every breakpoint without counting the scrollbar. "EVORA" measures 5.02em in the
            display face; dividing by 5.1 leaves a sliver of slack. Its letters rise into view
            the first time it scrolls in (`FooterWordmark`), echoing the hero's word. */}
        <div className="@container mt-14 sm:mt-20">
          <FooterWordmark
            className={cn(
              'block text-center text-[length:calc(100cqw/5.1)]/[0.8] tracking-[0.01em]',
              focusRing,
            )}
          />
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-sand-800 pt-6 text-[10px] tracking-[0.16em] text-sand-400 uppercase sm:flex-row sm:items-center sm:justify-between">
          <p>© EVORA. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'transition-colors hover:text-ivory pointer-coarse:tap-target pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center',
                  focusRing,
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </Container>
    </footer>
  );
}
