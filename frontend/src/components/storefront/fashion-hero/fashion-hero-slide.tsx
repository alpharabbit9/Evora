'use client';

import { motion, usePresence, usePresenceData } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { createSlideMotion, type HeroDirection, type SlideMotion } from './hero-motion';
import { figureSizes, type HeroCta, type HeroSlide } from './slides';

type FashionHeroSlideProps = {
  slide: HeroSlide;
  position: number;
  total: number;
  /**
   * False for the server-rendered first slide: it is visible before JavaScript runs and
   * must not be hidden again to replay an entrance.
   */
  animateIn: boolean;
  reducedMotion: boolean;
};

const BREAKPOINTS = ['base', 'md', 'lg'] as const;

/**
 * Resolves this slide's per-breakpoint values (set inline as `--name-base/-md/-lg`) into one
 * variable per name, so each layer needs a single class rather than three.
 */
const RESPONSIVE_VARS = [
  '[--figure-x:var(--figure-x-base)] [--figure-h:var(--figure-h-base)] [--figure-b:var(--figure-b-base)]',
  '[--headline-max:var(--headline-max-base)] [--headline-y:var(--headline-y-base)]',
  'md:[--figure-x:var(--figure-x-md)] md:[--figure-h:var(--figure-h-md)] md:[--figure-b:var(--figure-b-md)]',
  'md:[--headline-max:var(--headline-max-md)] md:[--headline-y:var(--headline-y-md)]',
  'lg:[--figure-x:var(--figure-x-lg)] lg:[--figure-h:var(--figure-h-lg)] lg:[--figure-b:var(--figure-b-lg)]',
  'lg:[--headline-max:var(--headline-max-lg)] lg:[--headline-y:var(--headline-y-lg)]',
].join(' ');

/**
 * Widest the word can be (gutter to gutter, times `span`, over its measured em width) or
 * `--headline-max` percent of the hero height, whichever is smaller. Container units resolve
 * against the hero stage, so the scrollbar and the 1680px cap are already accounted for.
 */
const HEADLINE_FONT_SIZE =
  'min(calc((100cqw - 2 * var(--hero-gutter)) * var(--headline-span) / var(--headline-measure)), calc(var(--headline-max) * 1cqh))';

function slideVariables({ accent, figure, headline, light }: HeroSlide): React.CSSProperties {
  const variables: Record<string, string> = {
    '--hero-accent': accent === 'muted' ? 'var(--muted-foreground)' : 'var(--foreground)',
    '--light-x': `${String(light.x)}%`,
    '--light-y': `${String(light.y)}%`,
    '--headline-span': String(headline.span),
    '--headline-measure': String(headline.measure + headline.text.length * headline.tracking),
  };
  for (const breakpoint of BREAKPOINTS) {
    const placement = figure[breakpoint];
    variables[`--figure-x-${breakpoint}`] = `${String(placement.x)}%`;
    variables[`--figure-h-${breakpoint}`] = `${String(placement.height)}%`;
    variables[`--figure-b-${breakpoint}`] = `${String(placement.bottom)}%`;
    variables[`--headline-max-${breakpoint}`] = String(headline.maxSize[breakpoint]);
    variables[`--headline-y-${breakpoint}`] = `${String(headline.y[breakpoint])}%`;
  }
  return variables as React.CSSProperties;
}

/**
 * One campaign frame, layered back to front: backdrop light, oversized word, model, copy.
 * Rendered inside `AnimatePresence`; `usePresence` keeps it mounted until its GSAP exit has
 * finished, so the outgoing frame is never cut off mid-move.
 */
export function FashionHeroSlide({
  slide,
  position,
  total,
  animateIn,
  reducedMotion,
}: FashionHeroSlideProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<SlideMotion | null>(null);
  const [isPresent, safeToRemove] = usePresence();
  // `AnimatePresence`'s `custom`: the latest navigation direction, also for a slide that is
  // already on its way out.
  const direction: HeroDirection = usePresenceData() === -1 ? -1 : 1;
  // Read once: a later change (the OS motion setting, the next navigation) must not tear
  // down and replay the entrance of a slide that is already on screen.
  const [initial] = useState(() => ({ animateIn, reducedMotion, direction }));

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // Layout effect: the entrance's starting state is applied before the browser paints, so
  // an incoming slide never flashes fully composed for a frame.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const slideMotion = createSlideMotion(root, { reducedMotion: initial.reducedMotion });
    if (initial.animateIn) slideMotion.enter(initial.direction);
    else slideMotion.idle();
    motionRef.current = slideMotion;
    return () => {
      motionRef.current = null;
      slideMotion.revert();
    };
  }, [initial]);

  useEffect(() => {
    if (isPresent || !safeToRemove) return;
    const slideMotion = motionRef.current;
    if (slideMotion) slideMotion.exit(direction, safeToRemove);
    else safeToRemove();
  }, [isPresent, safeToRemove, direction]);

  const { headline, image } = slide;

  return (
    <motion.div
      ref={rootRef}
      role="group"
      aria-roledescription="slide"
      aria-label={`${String(position + 1)} of ${String(total)}: ${slide.label}`}
      // The outgoing frame stays in the DOM for its exit; keep it out of the tab order and
      // the accessibility tree, and below the incoming one.
      inert={!isPresent}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0.3 : 0.7, ease: [0.25, 1, 0.5, 1] }}
      className={cn('absolute inset-0', RESPONSIVE_VARS)}
      style={{ ...slideVariables(slide), zIndex: isPresent ? 2 : 1 }}
    >
      {/* A soft studio light behind the model, from theme tokens: a touch brighter than the
          page in light mode, a lifted charcoal in dark mode so black tailoring keeps its edge. */}
      <div
        data-hero="light"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(46%_64%_at_var(--light-x)_var(--light-y),var(--card),transparent_76%)] dark:[background:radial-gradient(46%_64%_at_var(--light-x)_var(--light-y),color-mix(in_oklch,var(--accent)_58%,transparent),transparent_76%)]"
      />

      {/* Oversized word, behind the model. Decorative: the page heading carries the name. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-(--headline-y) z-10 -translate-y-1/2 px-(--hero-gutter)"
      >
        <div className="[translate:calc(var(--hero-px,0)*-10px)_calc(var(--hero-py,0)*-5px)]">
          <p
            data-hero="headline"
            className={cn(
              'flex justify-center leading-none whitespace-nowrap text-(--hero-accent)',
              headline.font === 'display' ? 'font-display' : 'font-heading font-normal',
            )}
            style={{
              fontSize: HEADLINE_FONT_SIZE,
              letterSpacing: `${String(headline.tracking)}em`,
            }}
          >
            {Array.from(headline.text).map((char, index) => (
              // Each letter rises through its own mask. The padding (cancelled by the
              // negative margin) keeps the mask clear of the glyph so nothing is clipped
              // at rest.
              <span
                key={index}
                className="-mx-[0.08em] -my-[0.14em] inline-block overflow-clip px-[0.08em] py-[0.14em]"
              >
                <span data-hero="char" className="inline-block">
                  {char}
                </span>
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Model. Sized by height; the PNG's own aspect ratio sets the width, so it is never
          stretched. Positioning, parallax depth, entrance and idle drift sit on separate
          wrappers so no two of them write the same property. */}
      <div
        className="pointer-events-none absolute bottom-(--figure-b) left-(--figure-x) z-20 h-(--figure-h) -translate-x-1/2"
        style={{ aspectRatio: `${String(image.width)} / ${String(image.height)}` }}
      >
        <div className="size-full [translate:calc(var(--hero-px,0)*18px)_calc(var(--hero-py,0)*9px)]">
          <div data-hero="figure" className="relative size-full">
            <span
              aria-hidden="true"
              className="absolute bottom-[0.4%] h-[3.5%] -translate-x-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--foreground)_24%,transparent),transparent)] dark:hidden"
              style={{
                left: `${String(slide.ground.x * 100)}%`,
                width: `${String(slide.ground.width * 100)}%`,
              }}
            />
            <div data-hero="drift" className="relative size-full">
              {imageFailed ? null : (
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes={figureSizes(slide)}
                  // The first frame is the LCP image; later ones are fetched ahead of time by
                  // the slider and only need to start at once when mounted.
                  {...(animateIn ? { loading: 'eager' as const } : { preload: true })}
                  onLoad={() => setImageLoaded(true)}
                  // A missing file leaves the composition intact: word and copy stay put.
                  onError={() => setImageFailed(true)}
                  className={cn(
                    'object-contain object-bottom transition-opacity duration-500',
                    animateIn && !imageLoaded && 'opacity-0',
                  )}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Copy. Above the model, in zones the figure placements keep clear. */}
      <ul className="absolute top-5 left-(--hero-gutter) z-30 flex items-center gap-3 text-[9px] font-medium tracking-[0.3em] text-muted-foreground uppercase md:top-[5.5%] md:gap-5 md:text-[10px]">
        {slide.eyebrow.map((item, index) => (
          <li
            key={item}
            data-hero="meta"
            className={cn('flex items-center gap-3 md:gap-5', index > 1 && 'max-sm:hidden')}
          >
            {index > 0 ? (
              <span aria-hidden="true" className="h-px w-5 bg-current opacity-50 md:w-9" />
            ) : null}
            {item}
          </li>
        ))}
      </ul>

      <p
        data-hero="meta"
        className="absolute top-[5.5%] right-(--hero-gutter) z-30 hidden text-right text-[10px] leading-[1.8] font-medium tracking-[0.32em] uppercase md:block"
      >
        {slide.statement.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </p>

      <div className="absolute top-12 left-(--hero-gutter) z-30 md:top-[14.5%]">
        <h2 className="text-[13px] leading-[1.6] font-normal tracking-[0.24em] uppercase md:text-[clamp(0.9rem,1.15vw,1.2rem)] md:tracking-[0.26em]">
          {slide.title.map((line, index) => (
            <Fragment key={line}>
              {/* Keeps the lines apart in the accessible name; collapses visually. */}
              {index > 0 ? ' ' : null}
              <span className="block overflow-clip">
                <span data-hero="line" className="block">
                  {line}
                </span>
              </span>
            </Fragment>
          ))}
        </h2>
        <span
          data-hero="rule"
          aria-hidden="true"
          className="mt-4 block h-px w-10 bg-(--hero-accent) md:mt-6"
        />
      </div>

      {/* Bottom band. Phones and tablets: CTAs above a full-width controls row. Desktop: CTAs
          and the collection label share one baseline, as in the campaign layout, and the
          controls sit above the label, where the figure is narrower than its stride. */}
      <div className="absolute inset-x-(--hero-gutter) bottom-[4.75rem] z-30 flex flex-wrap gap-3 md:right-auto md:bottom-[5.25rem] md:gap-4 lg:bottom-[7%]">
        <div data-hero="cta" className="flex-1 md:flex-none">
          <HeroLink cta={slide.primaryCta} tone="primary" />
        </div>
        {slide.secondaryCta ? (
          <div data-hero="cta" className="flex-1 md:flex-none">
            <HeroLink cta={slide.secondaryCta} tone="secondary" />
          </div>
        ) : null}
      </div>

      {slide.collection ? (
        <p
          data-hero="meta"
          className="absolute right-(--hero-gutter) bottom-[5.25rem] z-30 hidden text-[clamp(0.8rem,1vw,1.05rem)] leading-[1.55] tracking-[0.3em] uppercase md:block lg:bottom-[7%]"
        >
          {slide.collection.map((line, index) => (
            <Fragment key={line}>
              {index > 0 ? ' ' : null}
              <span className="block">{line}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
    </motion.div>
  );
}

function HeroLink({ cta, tone }: { cta: HeroCta; tone: 'primary' | 'secondary' }) {
  const primary = tone === 'primary';
  return (
    <Link
      href={cta.href}
      className={cn(
        buttonVariants({ variant: primary ? 'default' : 'outline' }),
        'group/cta h-12 w-full gap-3 px-5 text-[10px] font-semibold tracking-[0.26em] uppercase duration-300 md:w-auto md:px-7 lg:px-5 xl:px-7',
        !primary &&
          'border-foreground/25 bg-transparent hover:border-foreground hover:bg-transparent dark:border-foreground/25 dark:bg-transparent dark:hover:border-foreground dark:hover:bg-transparent',
      )}
    >
      {cta.label}
      {primary ? (
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/cta:translate-x-1"
        />
      ) : null}
    </Link>
  );
}
