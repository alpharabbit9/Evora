import { ArrowUpRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { ScrollParallax } from '@/components/storefront/scroll-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { ENTER } from '@/lib/motion/enter';
import { cn } from '@/lib/utils';

import { DemoNotice } from './catalog-header';
import { COLLECTION_BANNERS, COLLECTION_LINKS, type CollectionKey } from './collection-banners';

const FRAME = 'mx-auto w-full max-w-[1680px] px-4 pt-4 sm:px-6 sm:pt-6 lg:px-10 xl:px-14';
const BANNER_HEIGHT = 'min-h-[clamp(22rem,15rem+20vw,36rem)]';

/** The banner's rendered width at each layout, for `next/image`. */
const SIZES =
  '(min-width: 1680px) 1568px, (min-width: 1024px) calc(100vw - 80px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)';

/**
 * The opener of a listing page: a campaign photograph in a dark, rounded frame, with the
 * page heading, a line of copy and a switcher between the store's collections.
 *
 * The frame carries the `dark` class (like the newsletter banner), so copy and controls use
 * the dark tokens in either site theme. The photograph is the page's largest paint, so it is
 * preloaded; it drifts slightly against the scroll (GSAP, `ScrollParallax`; still under
 * reduced motion). The copy rises in with CSS.
 *
 * A Server Component: only the parallax wrapper runs in the browser.
 */
export function CollectionBanner({
  collection,
  eyebrow,
  title,
  description,
}: {
  collection: CollectionKey;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const photo = COLLECTION_BANNERS[collection];

  return (
    <header className={FRAME}>
      <div
        className={cn(
          'dark relative isolate flex flex-col justify-end overflow-hidden rounded-lg bg-sand-950 text-foreground',
          BANNER_HEIGHT,
        )}
      >
        <ScrollParallax className="-z-20">
          <Image
            src={photo.src}
            alt=""
            fill
            preload
            sizes={SIZES}
            className="animate-in object-cover duration-[1800ms] ease-[cubic-bezier(0.16,1,0.3,1)] zoom-in-110 motion-reduce:animate-none"
            style={{ objectPosition: photo.position }}
          />
        </ScrollParallax>
        {/* The theme's on-image black, then weight behind the copy: from below on phones,
            where the copy spans the frame, and from the left on wider screens. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-(--overlay)" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-t from-sand-950/90 via-sand-950/45 to-sand-950/10 md:bg-linear-to-r md:from-sand-950/85 md:via-sand-950/40 md:to-transparent"
        />

        <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12 lg:p-14">
          <div className="max-w-2xl">
            <p
              className={cn(
                ENTER,
                'flex items-center gap-3 text-[10px] font-semibold tracking-[0.28em] text-foreground/75 uppercase delay-100 slide-in-from-bottom-2',
              )}
            >
              <span aria-hidden="true" className="h-px w-8 bg-current opacity-70" />
              {eyebrow}
            </p>
            {/* The heading rises out of a clip; padding inside it keeps descenders whole. */}
            <h1 className="mt-5 -mb-[0.12em] overflow-hidden pb-[0.12em] font-heading text-[clamp(2.6rem,1.8rem+3.4vw,5.25rem)] leading-[1.02] font-normal tracking-[-0.02em] text-balance">
              <span className={cn(ENTER, 'block delay-150 slide-in-from-bottom-full')}>
                {title}
              </span>
            </h1>
            <p
              className={cn(
                ENTER,
                'mt-5 max-w-[48ch] text-[15px] leading-7 text-foreground/80 delay-300 slide-in-from-bottom-3',
              )}
            >
              {description}
            </p>
          </div>

          <nav aria-label="Collections" className={cn(ENTER, 'delay-500 slide-in-from-bottom-3')}>
            <ul className="flex flex-wrap gap-2">
              {COLLECTION_LINKS.map((link) => {
                const current = link.key === collection;
                return (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'group inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[10px] font-semibold tracking-[0.2em] uppercase backdrop-blur-sm transition-[background-color,border-color,color] duration-300',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground',
                        current
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-foreground/35 bg-background/20 text-foreground hover:border-foreground hover:bg-foreground hover:text-background',
                      )}
                    >
                      {link.label}
                      {current ? null : (
                        <ArrowUpRight
                          aria-hidden="true"
                          strokeWidth={1.75}
                          className="-mr-1 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <p className="absolute top-4 right-5 text-[10px] tracking-[0.04em] text-foreground/70">
          Photo:{' '}
          <a
            href={photo.credit.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-foreground"
          >
            {photo.credit.name}
          </a>{' '}
          / Unsplash
        </p>
      </div>

      <DemoNotice className="mt-5 mb-8 max-w-3xl border-l border-border pl-3 text-xs leading-5 text-muted-foreground" />
    </header>
  );
}

/** The banner's footprint, for a listing route still loading. */
export function CollectionBannerSkeleton() {
  return (
    <div className={FRAME} aria-hidden="true">
      <Skeleton className={cn('w-full rounded-lg', BANNER_HEIGHT)} />
      <Skeleton className="mt-5 mb-8 h-10 w-full max-w-3xl" />
    </div>
  );
}
