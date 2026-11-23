'use client';

import {
  animate,
  AnimatePresence,
  MotionConfig,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from 'framer-motion';
import { gsap } from 'gsap';
import Image from 'next/image';
import { useEffect, useId, useReducer, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { FashionHeroSlide } from './fashion-hero-slide';
import type { HeroDirection } from './hero-motion';
import { HeroNavigation, HeroProgress } from './hero-navigation';
import { figureSizes, HERO_AUTOPLAY_SECONDS, HERO_SLIDES, type HeroSlide } from './slides';

type SliderState = {
  index: number;
  direction: HeroDirection;
  /** Bumped on every change of slide; keys the slide so each visit mounts fresh. */
  transition: number;
};

type SliderAction =
  { type: 'step'; delta: HeroDirection; count: number } | { type: 'jump'; index: number };

function sliderReducer(state: SliderState, action: SliderAction): SliderState {
  if (action.type === 'step') {
    return {
      index: (state.index + action.delta + action.count) % action.count,
      direction: action.delta,
      transition: state.transition + 1,
    };
  }
  if (action.index === state.index) return state;
  return {
    index: action.index,
    direction: action.index > state.index ? 1 : -1,
    transition: state.transition + 1,
  };
}

/** Minimum horizontal travel, in px, for a touch drag to count as a swipe. */
const SWIPE_DISTANCE = 48;

type FashionHeroSliderProps = {
  slides?: readonly HeroSlide[];
  /** Seconds per slide. */
  interval?: number;
};

/**
 * Home-page campaign hero: three art-directed frames that advance every `interval` seconds.
 *
 * Responsibilities are split by engine. Framer Motion owns presence (the outgoing and
 * incoming frames overlap, so there is never an empty frame), the autoplay clock and the
 * progress hairline it fills; GSAP owns the choreography inside each frame (`hero-motion.ts`)
 * and the pointer parallax, which it writes to two CSS variables on the section. CSS owns the
 * controls' press dip and the indicators (plan.md Phase 7).
 *
 * Autoplay pauses while a mouse is over the hero, while keyboard focus is inside it (WAI-ARIA
 * carousel pattern), while the tab is hidden, while the hero is scrolled out of view (no slide
 * changes nobody can see), and when the person presses pause (WCAG 2.2.2).
 */
export function FashionHeroSlider({
  slides = HERO_SLIDES,
  interval = HERO_AUTOPLAY_SECONDS,
}: FashionHeroSliderProps) {
  const count = slides.length;
  const [state, dispatch] = useReducer(sliderReducer, { index: 0, direction: 1, transition: 0 });
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [keyboardInside, setKeyboardInside] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [offScreen, setOffScreen] = useState(false);
  const [warmNext, setWarmNext] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;

  const sectionRef = useRef<HTMLElement>(null);
  const clockRef = useRef<AnimationPlaybackControls | null>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const progress = useMotionValue(0);
  const slidesId = useId();

  const paused = userPaused || hovering || keyboardInside || pageHidden || offScreen;
  const slide = slides[state.index];

  const step = (delta: HeroDirection) => dispatch({ type: 'step', delta, count });

  // The autoplay clock. One tween per slide visit: it fills the progress hairline and, on
  // completion, advances. Any change of slide (auto, button, swipe) restarts it from zero.
  useEffect(() => {
    if (count < 2) return;
    progress.set(0);
    const clock = animate(progress, 1, {
      duration: interval,
      ease: 'linear',
      onComplete: () => dispatch({ type: 'step', delta: 1, count }),
    });
    clockRef.current = clock;
    return () => {
      clockRef.current = null;
      clock.stop();
    };
  }, [state.transition, interval, count, progress]);

  // Declared after the clock so a fresh clock is paused in the same commit if it needs to be.
  useEffect(() => {
    const clock = clockRef.current;
    if (!clock) return;
    if (paused) clock.pause();
    else clock.play();
  }, [paused, state.transition]);

  useEffect(() => {
    const onVisibilityChange = () => setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const visibility = new IntersectionObserver(([entry]) => {
      if (entry) setOffScreen(!entry.isIntersecting);
    });
    visibility.observe(section);
    return () => visibility.disconnect();
  }, []);

  // Fetch the following slide's model once the page has finished loading, so it is decoded
  // before its entrance instead of popping in mid-transition.
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => setWarmNext(true), 600);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    return () => {
      window.removeEventListener('load', schedule);
      window.clearTimeout(timer);
    };
  }, []);

  // Pointer parallax for mouse users: GSAP eases two unitless variables (-1…1) on the
  // section, and each layer's depth wrapper turns them into a `translate` of its own size.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || reducedMotion) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    gsap.set(section, { '--hero-px': 0, '--hero-py': 0 });
    const toX = gsap.quickTo(section, '--hero-px', { duration: 1.6, ease: 'power3.out' });
    const toY = gsap.quickTo(section, '--hero-py', { duration: 1.6, ease: 'power3.out' });

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      toX((event.clientX / window.innerWidth) * 2 - 1);
      toY((event.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => {
      toX(0);
      toY(0);
    };

    section.addEventListener('pointermove', onMove);
    section.addEventListener('pointerleave', onLeave);
    return () => {
      section.removeEventListener('pointermove', onMove);
      section.removeEventListener('pointerleave', onLeave);
      gsap.killTweensOf(section);
      section.style.removeProperty('--hero-px');
      section.style.removeProperty('--hero-py');
    };
  }, [reducedMotion]);

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={sectionRef}
        aria-roledescription="carousel"
        aria-label="Featured collections"
        // Once the hero is behind the header, the header hides on scroll-down (plan.md 2.6).
        data-header-autohide=""
        className={cn(
          'relative isolate w-full shrink-0 overflow-clip bg-background text-foreground',
          // Fills the viewport under the sticky header (64 / 72 / 80px). Desktop is also held
          // to a 5:3 landscape frame, so tall portrait tablets and ultrawide monitors keep the
          // editorial proportions instead of stretching the composition.
          'h-[calc(100svh-4rem)] min-h-[35rem] sm:h-[calc(100svh-4.5rem)] md:max-h-[70rem]',
          'lg:h-[min(calc(100svh-5rem),calc(min(100vw,1680px)*0.6))] lg:min-h-[36rem]',
        )}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setHovering(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHovering(false);
        }}
        onFocus={(event) => {
          // Keyboard focus only: a mouse click on a control must not stop autoplay for good.
          if (event.target.matches(':focus-visible')) setKeyboardInside(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardInside(false);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch' && event.isPrimary) {
            swipeRef.current = { x: event.clientX, y: event.clientY };
          }
        }}
        onPointerUp={(event) => {
          const start = swipeRef.current;
          swipeRef.current = null;
          if (!start || event.pointerType !== 'touch') return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          step(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
      >
        {/* `--launcher-clearance`: how far the controls move left to clear the assistant
            launcher in the screen's corner (`--launcher-reach`, globals.css), less the gutter
            and any margin beyond the 1680px cap (`100cqw` resolves where it is used, inside
            this container). 0 when the assistant is off. Used as a `translate`, never as
            layout: the launcher mounts after load, and moving the row by padding was a
            layout shift. */}
        <div className="[container-type:size] relative mx-auto h-full w-full max-w-[1680px] touch-pan-y [--hero-gutter:1rem] [--launcher-clearance:max(0px,calc(var(--launcher-reach,0px)-var(--hero-gutter)-(100vw-100cqw)/2))] sm:[--hero-gutter:1.5rem] lg:[--hero-gutter:2.5rem] xl:[--hero-gutter:3.5rem]">
          {/* Announces a new slide only when the person is in control of it; while autoplay
              runs, changes stay silent. */}
          <div id={slidesId} aria-live={paused ? 'polite' : 'off'} className="absolute inset-0">
            <AnimatePresence initial={false} custom={state.direction}>
              <FashionHeroSlide
                key={`${slide.id}:${String(state.transition)}`}
                slide={slide}
                position={state.index}
                total={count}
                animateIn={state.transition > 0}
                reducedMotion={reducedMotion}
              />
            </AnimatePresence>
          </div>

          {count > 1 ? (
            <HeroNavigation
              slides={slides}
              index={state.index}
              direction={state.direction}
              playing={!userPaused}
              controlsId={slidesId}
              onPrevious={() => step(-1)}
              onNext={() => step(1)}
              onSelect={(index) => dispatch({ type: 'jump', index })}
              onTogglePlay={() => setUserPaused((value) => !value)}
              // Desktop: the row is as tall as the CTAs and shares their baseline, so the
              // bottom band reads as one line (actions left, controls right).
              // From `lg` the whole right-aligned row moves left to clear the assistant
              // launcher; below it only the control group does (HeroNavigation).
              className="absolute inset-x-(--hero-gutter) bottom-4 z-40 transition-[translate] duration-500 ease-(--ease-out) motion-reduce:transition-none md:bottom-6 lg:bottom-[7%] lg:left-auto lg:h-12 lg:-translate-x-(--launcher-clearance)"
            />
          ) : null}

          {count > 1 ? (
            // On the content gutters, a few pixels up: the hero ends exactly at the fold, so a
            // line on its very edge would sit on (or just under) the screen's last pixel row.
            <HeroProgress
              progress={progress}
              className="absolute inset-x-(--hero-gutter) bottom-2 z-40 md:bottom-3 lg:bottom-4"
            />
          ) : null}

          {warmNext && count > 1 ? (
            <FigurePreload slide={slides[(state.index + 1) % count]} />
          ) : null}
        </div>
      </section>
    </MotionConfig>
  );
}

/**
 * Loads a model PNG with the same `src` and `sizes` as its slide, so the browser picks the
 * same srcset candidate and the slide's own image is a cache hit.
 */
function FigurePreload({ slide }: { slide: HeroSlide }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible absolute size-px overflow-hidden"
    >
      <div className="relative size-full">
        <Image
          key={slide.id}
          src={slide.image.src}
          alt=""
          fill
          sizes={figureSizes(slide)}
          loading="eager"
          fetchPriority="low"
        />
      </div>
    </div>
  );
}
