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
  /** 0 → 1 over the autoplay interval; drives the active indicator's fill. */
  progress: MotionValue<number>;
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
 * Slide counter, indicators and previous / next / pause. Framer Motion owns every animated
 * property in here; GSAP never touches these elements.
 */
export function HeroNavigation({
  slides,
  index,
  direction,
  progress,
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
        {/* Visual only: each slide's own label already says "2 of 3". Dropped on small
            laptops, where the controls share the bottom right with the model's stride. */}
        <p
          aria-hidden="true"
          className="hidden items-center text-[11px] font-medium tracking-[0.18em] tabular-nums sm:flex lg:hidden xl:flex"
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
                className={cn('group grid h-8 place-items-center rounded-sm px-1.5', focusRing)}
              >
                <motion.span
                  initial={false}
                  animate={{ width: active ? 48 : 18 }}
                  transition={{ duration: 0.6, ease: EASE_OUT }}
                  className={cn(
                    'relative block h-0.5 overflow-hidden rounded-full transition-colors duration-300',
                    active ? 'bg-foreground/20' : 'bg-foreground/55 group-hover:bg-foreground',
                  )}
                >
                  {active ? (
                    <motion.span
                      className="absolute inset-0 origin-left bg-foreground"
                      style={{ scaleX: progress }}
                    />
                  ) : null}
                </motion.span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
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
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-controls={controls}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn(
        'grid size-9 place-items-center rounded-full border border-foreground/30 text-foreground transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background md:size-10',
        focusRing,
      )}
    >
      {children}
    </motion.button>
  );
}
