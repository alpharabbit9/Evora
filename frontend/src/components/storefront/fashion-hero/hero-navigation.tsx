'use client';

import { AnimatePresence, motion, type MotionValue, type Variants } from 'framer-motion';
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { HeroDirection } from './hero-motion';
import type { HeroSlide } from './slides';

type HeroNavigationProps = {
  slides: readonly HeroSlide[];
  index: number;
  direction: HeroDirection;
  /** Whether autoplay is on (the person has not pressed pause). */
  playing: boolean;
  /** Id of the element the slides render into, for `aria-controls`. */
  controlsId: string;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  onTogglePlay: () => void;
  className?: string;
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const counterVariants: Variants = {
  enter: (direction: HeroDirection) => ({ y: direction > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { y: '0%', opacity: 1 },
  exit: (direction: HeroDirection) => ({ y: direction > 0 ? '-100%' : '100%', opacity: 0 }),
};

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Slide counter, indicators and previous / next / pause. GSAP never touches these elements.
 * Framer Motion owns the counter's roll; CSS owns the indicators' colour and thickness and the
 * controls' press dip (`press`, plan.md Phase 7.1).
 */
export function HeroNavigation({
  slides,
  index,
  direction,
  playing,
  controlsId,
  onPrevious,
  onNext,
  onSelect,
  onTogglePlay,
  className,
}: HeroNavigationProps) {
  const total = slides.length;

  return (
    <div
      className={cn('flex items-center justify-between gap-4 md:justify-end md:gap-7', className)}
    >
      <div className="flex items-center gap-3 md:gap-4">
        {/* Visual only: each slide's own label already says "2 of 3". Desktop drops it: the
            controls share the CTA baseline there, level with the model's stride, and the
            counter would sit on the leading shoe. */}
        <p
          aria-hidden="true"
          className="hidden items-center text-[11px] font-medium tracking-[0.18em] tabular-nums sm:flex lg:hidden"
        >
          <span className="relative h-[1.4em] w-[2.4ch] overflow-clip">
            <AnimatePresence initial={false} custom={direction}>
              <motion.span
                key={index}
                custom={direction}
                variants={counterVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.6, ease: EASE_OUT }}
                className="absolute inset-0 flex items-center"
              >
                {String(index + 1).padStart(2, '0')}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="mx-2.5 h-px w-4 bg-current opacity-40" />
          <span className="text-muted-foreground">{String(total).padStart(2, '0')}</span>
        </p>

        <div role="group" aria-label="Choose a slide" className="flex items-center">
          {slides.map((slide, slideIndex) => {
            const active = slideIndex === index;
            return (
              <button
                key={slide.id}
                type="button"
                onClick={() => onSelect(slideIndex)}
                aria-label={`Slide ${String(slideIndex + 1)} of ${String(total)}: ${slide.label}`}
                aria-current={active ? 'true' : undefined}
                aria-controls={controlsId}
                className={cn('group grid h-11 place-items-center rounded-sm px-2.5', focusRing)}
              >
                {/* Fixed size: only colour and a vertical thickening change, so choosing a
                    slide never moves its neighbours (no layout shift). The autoplay timer is
                    the hairline along the hero's foot (`HeroProgress`). */}
                <span
                  className={cn(
                    'block h-0.5 w-6 origin-center rounded-full transition-[background-color,scale] duration-300 ease-(--ease-out) motion-reduce:transition-none',
                    active
                      ? 'scale-y-150 bg-foreground'
                      : 'bg-foreground/35 group-hover:bg-foreground/80 group-active:bg-foreground',
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Below `lg` the row spans the hero, so only this group moves left to clear the
          assistant launcher (`--launcher-clearance`, set on the hero's container). */}
      <div className="flex items-center gap-2 transition-[translate] duration-500 ease-(--ease-out) motion-reduce:transition-none max-lg:-translate-x-(--launcher-clearance)">
        <ControlButton label="Previous slide" controls={controlsId} onClick={onPrevious}>
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </ControlButton>
        <ControlButton label="Next slide" controls={controlsId} onClick={onNext}>
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </ControlButton>
        <ControlButton
          label={playing ? 'Pause slideshow' : 'Play slideshow'}
          onClick={onTogglePlay}
        >
          {playing ? (
            <Pause className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Play className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          )}
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  controls,
  onClick,
  children,
}: {
  label: string;
  controls?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    // Press feedback is the shared CSS `press` dip (globals.css), deeper on this small round
    // control than on the wide CTAs.
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-controls={controls}
      className={cn(
        'press tap-target grid size-9 place-items-center rounded-full border border-foreground/30 text-foreground [--press-scale:0.92] hover:border-foreground hover:bg-foreground hover:text-background active:bg-foreground/85 md:size-10',
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The autoplay timer as a hairline along the hero's foot (plan.md Phase 7.5, the TOTEME
 * pattern): it fills left to right over the slide's interval, holds while autoplay is paused,
 * and starts again on every change of slide. Decorative: the slide buttons carry the state for
 * assistive technology, and the pause button is the control (WCAG 2.2.2).
 *
 * Framer Motion owns the fill's `scaleX` (it reads the slider's clock directly, so nothing
 * re-renders per frame). Transform only, so it never shifts layout. It keeps running under
 * reduced motion: a slow linear fill is the only sign that the slides will change.
 */
export function HeroProgress({
  progress,
  className,
}: {
  /** 0 → 1 over the autoplay interval. */
  progress: MotionValue<number>;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none h-px overflow-hidden bg-foreground/12', className)}
    >
      <motion.div className="h-full origin-left bg-foreground/70" style={{ scaleX: progress }} />
    </div>
  );
}
