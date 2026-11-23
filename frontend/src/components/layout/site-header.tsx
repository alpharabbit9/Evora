'use client';

import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { COLLECTION_BANNERS } from '@/components/catalog/collection-banners';
import { useSession } from '@/lib/auth-client';
import { useCartBadge } from '@/lib/cart/use-cart';
import { cn } from '@/lib/utils';
import { useWishlistBadge } from '@/lib/wishlist/use-wishlist';

import { Wordmark } from './brand';
import { CONTAINER } from './container';
import {
  currentLinkHref,
  HELP_LINKS,
  NEW_ARRIVALS_LINK,
  type NavLink,
  SHOP_LINKS,
  SIGNED_IN_LINKS,
  SIGNED_OUT_LINKS,
} from './nav-links';
import { ThemeMenuSwitch, ThemeToggle } from './theme-toggle';
import { useHeaderAutohide } from './use-header-autohide';

/**
 * The menu panel's "Shop" column at `lg` and up: one photograph per collection, the same ones
 * the collection pages open with, so the tile and the page it leads to look alike.
 */
const SHOP_TILES = [
  { link: SHOP_LINKS[0], photo: COLLECTION_BANNERS.men },
  { link: SHOP_LINKS[1], photo: COLLECTION_BANNERS.women },
] as const;

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

/**
 * Hands `children` the href of whichever of `links` is the page being viewed (`null` for none).
 * `useSearchParams` needs a `<Suspense>` boundary under `cacheComponents`; the fallback renders
 * the same links with nothing marked current, so the prerendered HTML matches the layout.
 */
function WithCurrentHref({
  links,
  children,
}: {
  links: readonly NavLink[];
  children: (currentHref: string | null) => React.ReactNode;
}) {
  return (
    <Suspense fallback={children(null)}>
      <CurrentHref links={links}>{children}</CurrentHref>
    </Suspense>
  );
}

function CurrentHref({
  links,
  children,
}: {
  links: readonly NavLink[];
  children: (currentHref: string | null) => React.ReactNode;
}) {
  const pathname = usePathname();
  const category = useSearchParams().get('category');
  return children(currentLinkHref(links, pathname, category));
}

const ariaCurrent = (href: string, currentHref: string | null) =>
  href === currentHref ? ('page' as const) : undefined;

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Decides which link to show, nothing more: /account asks the API itself before rendering
  // anything private. Until the session read settles, the signed-out link is shown.
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const scrolled = useScrolled();
  const hidden = useHeaderAutohide(menuOpen);
  const cartCount = useCartBadge(session?.user.id);
  const wishlistCount = useWishlistBadge(session?.user.id);

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

  const accountLinks = signedIn ? SIGNED_IN_LINKS : SIGNED_OUT_LINKS;
  const shopLinks = [NEW_ARRIVALS_LINK, ...SHOP_LINKS];
  const menuGroups: { title: string; links: readonly NavLink[] }[] = [
    { title: 'Account', links: accountLinks },
    { title: 'Help', links: HELP_LINKS },
  ];
  const panelLinks = [...shopLinks, ...accountLinks, ...HELP_LINKS];

  const panelLink = cn(
    'inline-block text-[15px] font-medium text-foreground/80 transition-colors hover:text-foreground',
    'aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-1 aria-[current=page]:underline-offset-[6px]',
    focusRing,
  );

  return (
    <header
      ref={headerRef}
      // Same background as the page, so at the top the bar blends into what is below it (the
      // home hero is designed to run straight up to it). The rule only appears once content
      // scrolls underneath.
      // `data-hidden` (plan.md 2.6): slides up out of view on scroll-down past the home hero.
      // It stays sticky, so nothing below moves. Keyboard focus inside brings it back.
      data-hidden={hidden || undefined}
      className={cn(
        'sticky top-0 z-50 border-b bg-background/90 text-foreground backdrop-blur-md',
        'transition-[color,background-color,border-color,translate] duration-300 ease-(--ease-out) motion-reduce:transition-none',
        'data-hidden:-translate-y-full data-hidden:has-[:focus-visible]:translate-y-0',
        scrolled ? 'border-border' : 'border-transparent',
      )}
    >
      {/* Not `relative`: the menu panel positions against the header so it spans the
          viewport, not this max-width row. */}
      <div
        className={cn(
          CONTAINER,
          'grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 sm:h-[72px] lg:h-20 lg:gap-6',
        )}
      >
        <div className="flex min-w-0 items-center gap-3 xl:gap-7">
          {/* Bare icon like the actions on the right. The 44px box is the hit area (plan.md
              Phase 8); the negative margin lines the glyph, not the box, up with the page
              gutter. */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="site-menu-panel"
            className={cn(
              // `press`: the shared dip while held (globals.css, plan.md Phase 7).
              'press group -ml-3 grid size-11 shrink-0 place-items-center rounded-md [--press-scale:0.92]',
              'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
            )}
          >
            <span className="grid transition-transform duration-300 group-hover:-translate-y-0.5">
              <Menu
                className="menu-icon col-start-1 row-start-1 size-5 group-aria-expanded:-rotate-90 group-aria-expanded:opacity-0"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <X
                className="menu-icon col-start-1 row-start-1 size-5 rotate-90 opacity-0 group-aria-expanded:rotate-0 group-aria-expanded:opacity-100"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </span>
          </button>

          {/* Directly after its toggle, so Tab moves from the button into the panel. Always
              mounted so it can animate out; `globals.css` (.site-menu-panel) owns its opacity,
              translate and the timing of the display flip. `inert` takes it out of the tab
              order and the accessibility tree the moment it starts closing.

              `data-[state=closed]:hidden` repeats the closed `display: none` on purpose: the
              panel must never sit open over the page just because the motion rules are
              missing (a stale dev stylesheet once did exactly that). Without them the panel
              still opens and closes, only without the animation; with them, the
              `allow-discrete` transition still delays this `none` until the exit finishes. */}
          <div
            id="site-menu-panel"
            data-state={menuOpen ? 'open' : 'closed'}
            inert={!menuOpen}
            className="site-menu-panel absolute inset-x-0 top-full border-y border-border bg-background shadow-lg data-[state=closed]:hidden"
          >
            {/* `data-lenis-prevent` hands wheel and touch scrolling back to the browser
                here; otherwise Lenis scrolls the page behind the panel instead. */}
            <nav
              aria-label="Site menu"
              data-lenis-prevent
              className={cn(
                CONTAINER,
                'max-h-[calc(100dvh-4rem)] overflow-y-auto py-8 sm:max-h-[calc(100dvh-4.5rem)] lg:max-h-[calc(100dvh-5rem)] lg:py-10',
              )}
            >
              <WithCurrentHref links={panelLinks}>
                {(currentHref) => (
                  <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
                    <div>
                      <MenuGroupTitle>Shop</MenuGroupTitle>
                      {/* Below `lg` the inline nav is hidden, so the panel lists every
                          collection. From `lg` the photographs lead and the text list keeps
                          only what the inline nav does not already offer. */}
                      <ul className="mt-4 hidden grid-cols-2 gap-4 lg:grid xl:gap-6">
                        {SHOP_TILES.map(({ link, photo }) => (
                          <li key={link.href}>
                            <ShopTile
                              href={link.href}
                              label={link.label}
                              src={photo.src}
                              position={photo.position}
                              current={ariaCurrent(link.href, currentHref)}
                              onNavigate={closeMenu}
                            />
                          </li>
                        ))}
                      </ul>
                      <ul className="mt-4 space-y-3 lg:mt-6">
                        {shopLinks.map((link) => (
                          <li
                            key={link.href}
                            className={cn(link !== NEW_ARRIVALS_LINK && 'lg:hidden')}
                          >
                            <Link
                              href={link.href}
                              onClick={closeMenu}
                              aria-current={ariaCurrent(link.href, currentHref)}
                              className={panelLink}
                            >
                              {link.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {menuGroups.map((group) => (
                      <div key={group.title}>
                        <MenuGroupTitle>{group.title}</MenuGroupTitle>
                        <ul className="mt-4 space-y-3">
                          {group.links.map((link) => (
                            <li key={link.href}>
                              <Link
                                href={link.href}
                                onClick={closeMenu}
                                aria-current={ariaCurrent(link.href, currentHref)}
                                className={panelLink}
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
                      <MenuGroupTitle>Appearance</MenuGroupTitle>
                      <ThemeMenuSwitch className={cn('mt-4', focusRing)} />
                    </div>
                  </div>
                )}
              </WithCurrentHref>
            </nav>
          </div>

          <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex xl:gap-9">
            <WithCurrentHref links={SHOP_LINKS}>
              {(currentHref) =>
                SHOP_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={ariaCurrent(link.href, currentHref)}
                    className={cn(
                      'tap-target py-1 text-[11px] font-semibold tracking-[0.16em] uppercase transition-colors',
                      'after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-right after:scale-x-0 after:bg-current after:transition-transform after:duration-300 hover:after:origin-left hover:after:scale-x-100',
                      // The page being viewed keeps its underline.
                      'aria-[current=page]:after:scale-x-100',
                      focusRing,
                    )}
                  >
                    {link.label}
                  </Link>
                ))
              }
            </WithCurrentHref>
          </nav>
        </div>

        <Wordmark
          onClick={closeMenu}
          className={cn(
            'inline-flex min-h-11 items-center justify-self-center text-[1.35rem]/none sm:text-[1.6rem]/none lg:text-[1.75rem]/none xl:text-[2.1rem]/none',
            focusRing,
          )}
        />

        {/* Below `xl` every action is a bare 44px icon box, side by side (plan.md Phase 8:
            44px tap targets); the negative margin lines the last glyph up with the gutter. */}
        <div className="-mr-[13px] flex min-w-0 items-center justify-end xl:mr-0 xl:gap-7">
          {/* In the menu panel on phones, beside the other links that move there. */}
          <ThemeToggle
            className={cn('min-h-11 min-w-11 justify-center max-sm:hidden', focusRing)}
          />
          <HeaderAction href="/search" icon={Search} label="Search" />
          <HeaderAction
            href={signedIn ? '/account' : '/sign-in'}
            icon={User}
            label={signedIn ? 'Account' : 'Login'}
            // In the menu panel's Account group on phones: three 44px boxes beside the
            // wordmark do not fit a 360px screen (plan.md Phase 8).
            className="max-sm:hidden"
          />
          <HeaderAction
            href="/wishlist"
            icon={Heart}
            label="Wishlist"
            count={wishlistCount}
            // Also in the menu panel; dropped on phones so the wordmark keeps its room.
            className="max-sm:hidden"
          />
          <HeaderAction href="/cart" icon={ShoppingBag} label="Cart" count={cartCount} />
        </div>
      </div>
    </header>
  );
}

function MenuGroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

/**
 * A collection photograph with its name set below in the editorial serif. The image is
 * decorative (the name is the link's text). It loads lazily: the panel is `display: none`
 * until first opened, and these tiles are `display: none` below `lg`, so a phone never
 * downloads them.
 */
function ShopTile({
  href,
  label,
  src,
  position,
  current,
  onNavigate,
}: {
  href: string;
  label: string;
  src: string;
  position: string;
  current: 'page' | undefined;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current}
      className={cn('group/tile block', focusRing)}
    >
      <span className="relative block aspect-[4/5] overflow-hidden rounded-sm bg-sand-900">
        <Image
          src={src}
          alt=""
          fill
          loading="lazy"
          sizes="(min-width: 1680px) 340px, (min-width: 1024px) 22vw, 1px"
          style={{ objectPosition: position }}
          className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/tile:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100"
        />
      </span>
      <span
        className={cn(
          'mt-3 inline-block font-heading text-xl/tight text-foreground underline-offset-[6px]',
          'decoration-1 group-hover/tile:underline group-aria-[current=page]/tile:underline',
        )}
      >
        {label}
      </span>
    </Link>
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
  const pop = usePopKey(count);
  // Remounted under a new key only when a known count changes, so `.badge-pop` plays once.
  const popClass = pop > 0 ? 'badge-pop' : undefined;

  return (
    <Link
      href={href}
      aria-label={hasCount ? `${label}, ${String(count)} items` : label}
      className={cn(
        'press group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 text-[10px] font-semibold tracking-[0.16em] uppercase [--press-scale:0.94] max-xl:min-w-11',
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
            key={pop}
            className={cn(
              'absolute -top-1.5 -right-2 grid size-4 place-items-center rounded-full bg-foreground text-[9px] leading-none font-bold text-background xl:hidden',
              popClass,
            )}
            aria-hidden="true"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </span>
      {/* From xl only: below 1280px the labelled row would run into the wordmark. */}
      <span className="hidden xl:inline">
        {label}
        {hasCount ? (
          <>
            {' '}
            <span key={pop} className={cn('inline-block tabular-nums', popClass)}>
              ({String(count)})
            </span>
          </>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * Counts how many times a known count has changed (plan.md Phase 7.3). Going from unknown to a
 * number (the cart loading, signing in) does not count, so nothing pops on page load. React's
 * "adjust state while rendering" pattern: no effect, no extra commit.
 */
function usePopKey(count: number | undefined): number {
  const [seen, setSeen] = useState({ count, key: 0 });
  if (seen.count !== count) {
    const changed = seen.count !== undefined && count !== undefined;
    setSeen({ count, key: changed ? seen.key + 1 : seen.key });
  }
  return seen.key;
}
