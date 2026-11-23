import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { EDITORIAL_TILE } from './collection-banners';

/** The theme's `--ease-out`. */
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

/**
 * A campaign tile set into the product grid: two columns wide, one card tall from `md`, and a
 * full-width 4:3 band on phones. It sends the visitor to a real category (`/shop?category=bags`),
 * so it is a shortcut, not an advert for something the store cannot show.
 *
 * Rendered as a grid `<li>` by the listing, which shows it only on the first page of an
 * unfiltered, unsearched collection; anywhere narrower it would push results apart.
 */
export function EditorialTile({ className }: { className?: string }) {
  return (
    <li className={cn('col-span-2', className)}>
      <Link
        href="/shop?category=bags"
        className="group dark relative isolate flex aspect-[4/3] h-full flex-col justify-end overflow-hidden rounded-md bg-sand-950 p-6 text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:p-8 md:aspect-auto lg:p-10"
      >
        <Image
          src={EDITORIAL_TILE.src}
          alt=""
          fill
          sizes="(min-width: 1280px) 40vw, (min-width: 768px) 60vw, 100vw"
          className={cn(
            '-z-20 object-cover transition-[scale] duration-[1600ms] group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100',
            EASE,
          )}
          style={{ objectPosition: EDITORIAL_TILE.position }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-t from-sand-950/90 via-sand-950/40 to-sand-950/5 transition-opacity duration-500 group-hover:opacity-90"
        />

        <span className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.26em] text-foreground/75 uppercase">
          <span
            aria-hidden="true"
            className={cn(
              'h-px w-8 origin-left bg-current transition-[scale] duration-700 group-hover:scale-x-150',
              EASE,
            )}
          />
          The detail
        </span>
        <span className="mt-4 block max-w-[16ch] font-heading text-[clamp(1.75rem,1.3rem+1.6vw,2.75rem)] leading-[1.05] text-balance">
          Carry it darker
        </span>
        <span className="mt-3 block max-w-[38ch] text-sm leading-6 text-foreground/80">
          Handbags, messengers and duffels to finish the look.
        </span>
        <span className="mt-6 inline-flex items-center gap-3 self-start rounded-full bg-foreground px-5 py-3 text-[10px] font-semibold tracking-[0.24em] text-background uppercase transition-colors duration-300 group-hover:bg-sand-300">
          Shop bags
          <ArrowRight
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3.5 transition-transform duration-500 group-hover:translate-x-1 motion-reduce:transition-none',
              EASE,
            )}
          />
        </span>
        <span className="absolute top-4 right-5 text-[10px] text-foreground/70">
          Photo: {EDITORIAL_TILE.credit.name} / Unsplash
        </span>
      </Link>
    </li>
  );
}
