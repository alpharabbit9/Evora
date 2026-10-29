import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { Wordmark } from './brand';

const FOOTER_GROUPS = [
  {
    title: 'Shop',
    links: [
      { label: 'New arrivals', href: '/collections/new' },
      { label: 'Men', href: '/collections/men' },
      { label: 'Women', href: '/collections/women' },
      { label: 'Accessories', href: '/shop?category=accessories' },
      { label: 'Shop all', href: '/shop' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', href: '/sign-in' },
      { label: 'Create account', href: '/sign-up' },
      { label: 'My account', href: '/account' },
      { label: 'Wishlist', href: '/wishlist' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Our story', href: '/about' },
      { label: 'Journal', href: '/journal' },
      { label: 'Careers', href: '/careers' },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Contact', href: '/contact' },
      { label: 'Shipping & returns', href: '/shipping' },
      { label: 'Size guide', href: '/size-guide' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
];

const LEGAL_LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Accessibility', href: '/accessibility' },
];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ivory';

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-charcoal text-ivory">
      <div className="mx-auto w-full max-w-[1680px] px-4 pt-14 pb-7 sm:px-6 sm:pt-16 lg:px-10 lg:pt-20 xl:px-14">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_2fr] lg:gap-20">
          <div>
            <p className="max-w-sm text-lg leading-7 text-balance sm:text-xl sm:leading-8">
              Considered clothing and objects for a slower, more deliberate everyday.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-sand-400">
              Designed to be worn, kept, and returned to.
            </p>
            <Link
              href="/about"
              className={cn(
                'group mt-7 inline-flex items-center gap-2 border-b border-ivory/30 pb-1 text-[10px] font-semibold tracking-[0.2em] uppercase transition-colors hover:border-ivory',
                focusRing,
              )}
            >
              Our story
              <ArrowUpRight
                className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="text-[10px] font-semibold tracking-[0.22em] uppercase">
                  {group.title}
                </h2>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className={cn(
                          'text-sm text-sand-400 transition-colors hover:text-ivory',
                          focusRing,
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Sized against this row's width (cqw), not the viewport's, so it fills the row at
            every breakpoint without counting the scrollbar. "EVORA" measures 5.02em in the
            display face; dividing by 5.1 leaves a sliver of slack. */}
        <div className="@container mt-14 sm:mt-20">
          <Wordmark
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
                className={cn('transition-colors hover:text-ivory', focusRing)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
