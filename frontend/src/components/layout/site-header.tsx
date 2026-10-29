'use client';

import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useSession } from '@/lib/auth-client';
import { useCartBadge } from '@/lib/cart/use-cart';
import { cn } from '@/lib/utils';

import { Wordmark } from './brand';
import { ThemeMenuSwitch, ThemeToggle } from './theme-toggle';

type MenuLink = {
  label: string;
  href: string;
};

// Kids and Beauty were removed: there is no catalog behind them (fashion-catalog plan, D9).
const SHOP_LINKS: MenuLink[] = [
  { label: 'Men', href: '/collections/men' },
  { label: 'Women', href: '/collections/women' },
  { label: 'Accessories', href: '/shop?category=accessories' },
  { label: 'Shop all', href: '/shop' },
];

const SIGNED_OUT_LINKS: MenuLink[] = [
  { label: 'Sign in', href: '/sign-in' },
  { label: 'Create account', href: '/sign-up' },
  { label: 'Wishlist', href: '/wishlist' },
];

const SIGNED_IN_LINKS: MenuLink[] = [
  { label: 'My account', href: '/account' },
  { label: 'Wishlist', href: '/wishlist' },
];

const COMPANY_LINKS: MenuLink[] = [
  { label: 'Our story', href: '/about' },
  { label: 'Journal', href: '/journal' },
  { label: 'Contact', href: '/contact' },
  { label: 'Shipping & returns', href: '/shipping' },
];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

function subscribeToScroll(onChange: () => void) {
  window.addEventListener('scroll', onChange, { passive: true });
  return () => window.removeEventListener('scroll', onChange);
}

/** True once the page has scrolled under the sticky header; false on the server. */
function useScrolled() {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 0,
    () => false,
  );
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Decides which link to show, nothing more: /account asks the API itself before rendering
  // anything private. Until the session read settles, the signed-out link is shown.
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const scrolled = useScrolled();
  const cartCount = useCartBadge(session?.user.id);

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && headerRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const menuGroups: { title: string; links: MenuLink[] }[] = [
    { title: 'Shop', links: [{ label: 'New arrivals', href: '/collections/new' }, ...SHOP_LINKS] },
    { title: 'Account', links: signedIn ? SIGNED_IN_LINKS : SIGNED_OUT_LINKS },
    { title: 'Company', links: COMPANY_LINKS },
  ];

  return (
    <header
      ref={headerRef}
      // Same background as the page, so at the top the bar blends into what is below it (the
      // home hero is designed to run straight up to it). The rule only appears once content
      // scrolls underneath.
      className={cn(
        'sticky top-0 z-50 border-b bg-background/90 text-foreground backdrop-blur-md transition-colors duration-300',
        scrolled ? 'border-border' : 'border-transparent',
      )}
    >
      {/* Not `relative`: the menu panel positions against the header so it spans the
          viewport, not this max-width row. */}
      <div className="mx-auto grid h-16 w-full max-w-[1680px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:h-[72px] sm:px-6 lg:h-20 lg:gap-6 lg:px-10 xl:px-14">
        <div className="flex min-w-0 items-center gap-5 xl:gap-9">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="site-menu-panel"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-[10px] bg-card ring-1 ring-border transition-colors hover:bg-secondary sm:size-10',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            {menuOpen ? (
              <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          {/* Directly after its toggle, so Tab moves from the button into the panel. */}
          {menuOpen ? (
            <div
              id="site-menu-panel"
              className="absolute inset-x-0 top-full animate-in border-y border-border bg-background shadow-lg duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none"
            >
              {/* `data-lenis-prevent` hands wheel and touch scrolling back to the browser
                  here; otherwise Lenis scrolls the page behind the panel instead. */}
              <nav
                aria-label="Site menu"
                data-lenis-prevent
                className="mx-auto max-h-[calc(100dvh-4rem)] w-full max-w-[1680px] overflow-y-auto px-4 py-8 sm:max-h-[calc(100dvh-4.5rem)] sm:px-6 lg:max-h-[calc(100dvh-5rem)] lg:px-10 lg:py-10 xl:px-14"
              >
                <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-3 lg:gap-12">
                  {menuGroups.map((group) => (
                    <div key={group.title}>
                      <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
                        {group.title}
                      </p>
                      <ul className="mt-4 space-y-3">
                        {group.links.map((link) => (
                          <li key={link.href}>
                            <Link
                              href={link.href}
                              onClick={closeMenu}
                              className={cn(
                                'inline-block text-[15px] font-medium text-foreground/80 transition-colors hover:text-foreground',
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
                  {/* Phones only: the header row has no room for the theme icon there. */}
                  <div className="sm:hidden">
                    <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
                      Appearance
                    </p>
                    <ThemeMenuSwitch className={cn('mt-4', focusRing)} />
                  </div>
                </div>
              </nav>
            </div>
          ) : null}

          <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex xl:gap-9">
            {SHOP_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative py-1 text-[11px] font-semibold tracking-[0.16em] uppercase transition-colors',
                  'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-300 hover:after:origin-left hover:after:scale-x-100',
                  focusRing,
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <Wordmark
          onClick={closeMenu}
          className={cn(
            'justify-self-center text-[1.35rem]/none sm:text-[1.6rem]/none lg:text-[1.75rem]/none xl:text-[2.1rem]/none',
            focusRing,
          )}
        />

        <div className="flex min-w-0 items-center justify-end gap-3 sm:gap-4 lg:gap-5 xl:gap-7">
          {/* In the menu panel on phones, beside the other links that move there. */}
          <ThemeToggle className={cn('max-sm:hidden', focusRing)} />
          <HeaderAction href="/search" icon={Search} label="Search" />
          <HeaderAction
            href={signedIn ? '/account' : '/sign-in'}
            icon={User}
            label={signedIn ? 'Account' : 'Login'}
          />
          <HeaderAction
            href="/wishlist"
            icon={Heart}
            label="Wishlist"
            // Also in the menu panel; dropped on phones so the wordmark keeps its room.
            className="max-sm:hidden"
          />
          <HeaderAction href="/cart" icon={ShoppingBag} label="Cart" count={cartCount} />
        </div>
      </div>
    </header>
  );
}

function HeaderAction({
  href,
  icon: Icon,
  label,
  count,
  className,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  className?: string;
}) {
  const hasCount = typeof count === 'number';

  return (
    <Link
      href={href}
      aria-label={hasCount ? `${label}, ${String(count)} items` : label}
      className={cn(
        'group inline-flex shrink-0 items-center gap-2 text-[10px] font-semibold tracking-[0.16em] uppercase',
        focusRing,
        className,
      )}
    >
      <span className="relative">
        <Icon
          className="size-[18px] transition-transform duration-300 group-hover:-translate-y-0.5"
          strokeWidth={1.6}
          aria-hidden="true"
        />
        {hasCount && count > 0 ? (
          <span
            className="absolute -top-1.5 -right-2 grid size-4 place-items-center rounded-full bg-foreground text-[9px] leading-none font-bold text-background xl:hidden"
            aria-hidden="true"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </span>
      {/* From xl only: below 1280px the labelled row would run into the wordmark. */}
      <span className="hidden xl:inline">
        {label}
        {hasCount ? ` (${String(count)})` : ''}
      </span>
    </Link>
  );
}
