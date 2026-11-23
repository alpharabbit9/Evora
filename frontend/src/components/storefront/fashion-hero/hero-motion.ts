import { gsap } from 'gsap';

/**
 * GSAP choreography for one hero slide: the entrance, the idle drift and the exit.
 *
 * Property ownership (nothing else may animate these, or the two engines fight over
 * `transform`):
 *
 * | Element                  | Owner          | Properties                                  |
 * |--------------------------|----------------|---------------------------------------------|
 * | slide root               | Framer Motion  | opacity (presence fade-in)                  |
 * | `[data-hero=light]`      | GSAP           | opacity (fade-out on exit)                  |
 * | `[data-hero=headline]`   | GSAP           | x, opacity                                  |
 * | `[data-hero=char]`       | GSAP           | yPercent (masked reveal)                    |
 * | `[data-hero=figure]`     | GSAP           | x, opacity (the only visibility owner: the  |
 * |                          |                | `<img>` inside never fades on its own)      |
 * | `[data-hero=drift]`      | GSAP           | y (idle drift only; paused off screen)      |
 * | `[data-hero=line]`       | GSAP           | yPercent, opacity (masked reveal)           |
 * | `[data-hero=rule]`       | GSAP           | scaleX, opacity                             |
 * | `[data-hero=meta]`/`cta` | GSAP           | y, opacity                                  |
 * | depth wrappers           | CSS            | `translate`, from `--hero-px`/`--hero-py`   |
 *
 * Everything runs inside one `gsap.context`, so `revert()` kills every tween this slide
 * created and restores inline styles — on unmount, on React Strict Mode's double effect, and
 * when an exit interrupts an entrance part-way through.
 */

export type HeroDirection = 1 | -1;

export type SlideMotion = {
  /**
   * Applies the incoming sequence's starting state (call before paint) and holds it, so the
   * entrance can wait for the model image. Nothing moves until `play`.
   */
  enter: (direction: HeroDirection) => void;
  /**
   * Starts the held entrance, then settles into the idle drift. `withFigure: false` plays the
   * word and copy only and keeps the model hidden, for an image that is not decoded yet;
   * `revealFigure` brings it in once it is.
   */
  play: (options: { withFigure: boolean }) => void;
  /** Walks the model in on its own, for an image that arrived after the entrance started. */
  revealFigure: () => void;
  /** Starts the idle drift without an entrance (the server-rendered first slide). */
  idle: () => void;
  /** Plays the outgoing sequence once, from wherever the slide currently is. */
  exit: (direction: HeroDirection, onComplete: () => void) => void;
  /**
   * Pauses the idle drift while the hero is off screen, and resumes it from where it stopped
   * when it returns (plan.md Phase 5: loops pause off screen). Remembered, so a drift that
   * starts later (after the entrance) starts paused if the hero has already left.
   */
  setOnScreen: (onScreen: boolean) => void;
  revert: () => void;
};

/** Luxury pacing: long, decelerating reveals in; short, accelerating moves out. */
const EASE = {
  reveal: 'expo.out',
  glide: 'power3.out',
  settle: 'power2.out',
  rule: 'power3.inOut',
  leave: 'power2.in',
  drift: 'sine.inOut',
} as const;

const SELECTOR = {
  light: '[data-hero="light"]',
  headline: '[data-hero="headline"]',
  chars: '[data-hero="char"]',
  figure: '[data-hero="figure"]',
  drift: '[data-hero="drift"]',
  lines: '[data-hero="line"]',
  rule: '[data-hero="rule"]',
  meta: '[data-hero="meta"]',
  ctas: '[data-hero="cta"]',
} as const;

/** Every layer except the model that fades as a whole under reduced motion. */
const COPY_FADE_LAYERS = [
  SELECTOR.headline,
  SELECTOR.lines,
  SELECTOR.rule,
  SELECTOR.meta,
  SELECTOR.ctas,
].join();

/** Every layer that fades out as a whole under reduced motion. */
const FADE_LAYERS = [COPY_FADE_LAYERS, SELECTOR.figure].join();

/** When the model starts its walk-in, in seconds after the entrance starts. */
const FIGURE_AT = 0.36;

export function createSlideMotion(
  root: HTMLElement,
  { reducedMotion }: { reducedMotion: boolean },
): SlideMotion {
  const ctx = gsap.context(() => {}, root);
  const q = gsap.utils.selector(root);

  let entrance: gsap.core.Timeline | null = null;
  let figureIn: gsap.core.Tween | null = null;
  let drift: gsap.core.Tween | null = null;
  let exiting = false;
  let onScreen = true;

  const idle = () => {
    if (reducedMotion || exiting) return;
    ctx.add(() => {
      // Seven pixels over seven seconds: felt rather than seen.
      drift = gsap.to(q(SELECTOR.drift), {
        y: -7,
        duration: 7,
        ease: EASE.drift,
        yoyo: true,
        repeat: -1,
        paused: !onScreen,
      });
    });
  };

  const setOnScreen = (next: boolean) => {
    onScreen = next;
    drift?.paused(!next);
  };

  const enter = (direction: HeroDirection) => {
    ctx.add(() => {
      // Built paused: the `from` tweens still render their starting state at once, so the
      // incoming frame is fully hidden while it waits for `play`.
      const tl = gsap.timeline({ paused: true, onComplete: idle });

      // The model is not part of the timeline. It has its own tween, started by `play` or by
      // `revealFigure`, so a slow image never holds back the word and copy, and the word and
      // copy never play over an empty figure box.
      gsap.set(
        q(SELECTOR.figure),
        reducedMotion ? { autoAlpha: 0 } : { x: -64 * direction, autoAlpha: 0 },
      );

      if (reducedMotion) {
        // Opacity only: no travel, no masks.
        tl.from(q(COPY_FADE_LAYERS), { autoAlpha: 0, duration: 0.45, ease: 'none' }, 0.1);
        entrance = tl;
        return;
      }

      // Phase B starts while Phase A is still leaving (it runs from 0 to 0.5s), so there is
      // no empty frame, but late enough that the two models never read as a double exposure.
      // Everything has settled by ~1.36s.
      //
      // The oversized word rises through its letter masks while drifting in from the side
      // opposite the model, so the two layers part like a parallax pair.
      tl.from(
        q(SELECTOR.chars),
        { yPercent: 118, duration: 0.9, ease: EASE.reveal, stagger: 0.045 },
        0.28,
      )
        .from(q(SELECTOR.headline), { x: 28 * direction, duration: 1.08, ease: EASE.glide }, 0.28)
        // Supporting copy follows once the headline has started to settle; CTAs come last.
        .from(
          q(SELECTOR.meta),
          { y: 10, autoAlpha: 0, duration: 0.6, ease: EASE.settle, stagger: 0.05 },
          0.5,
        )
        .from(
          q(SELECTOR.lines),
          { yPercent: 105, autoAlpha: 0, duration: 0.7, ease: EASE.glide, stagger: 0.08 },
          0.55,
        )
        .from(
          q(SELECTOR.rule),
          { scaleX: 0, transformOrigin: '0% 50%', duration: 0.6, ease: EASE.rule },
          0.75,
        )
        .from(
          q(SELECTOR.ctas),
          { y: 14, autoAlpha: 0, duration: 0.5, ease: EASE.settle, stagger: 0.08 },
          0.78,
        );

      entrance = tl;
    });
  };

  /** The model's walk-in (or fade), `delay` seconds from now. Runs at most once. */
  const startFigure = (delay: number) => {
    if (exiting || figureIn) return;
    ctx.add(() => {
      figureIn = reducedMotion
        ? gsap.to(q(SELECTOR.figure), { autoAlpha: 1, duration: 0.45, ease: 'none', delay })
        : // The model walks in along the direction of travel.
          gsap.to(q(SELECTOR.figure), { x: 0, autoAlpha: 1, duration: 1, ease: EASE.glide, delay });
    });
  };

  const play = ({ withFigure }: { withFigure: boolean }) => {
    if (exiting || !entrance) return;
    entrance.play();
    if (withFigure) startFigure(reducedMotion ? 0.1 : FIGURE_AT);
  };

  const exit = (direction: HeroDirection, onComplete: () => void) => {
    if (exiting) return;
    exiting = true;

    ctx.add(() => {
      // Freeze whatever is mid-flight; the exit tweens start from the current values.
      entrance?.kill();
      figureIn?.kill();
      drift?.kill();

      const tl = gsap.timeline({ onComplete });

      if (reducedMotion) {
        tl.to(q([FADE_LAYERS, SELECTOR.light].join()), {
          autoAlpha: 0,
          duration: 0.3,
          ease: 'none',
        });
        return;
      }

      // Phase A — model continues along the direction of travel, the word slips the other
      // way, and the small type lifts out with a short stagger.
      tl.to(
        q(SELECTOR.figure),
        { x: 44 * direction, autoAlpha: 0, duration: 0.5, ease: EASE.leave },
        0,
      )
        .to(
          q(SELECTOR.headline),
          { x: -32 * direction, autoAlpha: 0, duration: 0.45, ease: EASE.leave },
          0,
        )
        .to(
          q(SELECTOR.lines),
          { yPercent: -105, autoAlpha: 0, duration: 0.42, ease: EASE.leave, stagger: 0.04 },
          0,
        )
        .to(
          q([SELECTOR.meta, SELECTOR.rule, SELECTOR.ctas].join()),
          { y: -8, autoAlpha: 0, duration: 0.34, ease: EASE.leave, stagger: 0.025 },
          0,
        )
        .to(q(SELECTOR.light), { autoAlpha: 0, duration: 0.7, ease: 'none' }, 0);
    });
  };

  return {
    enter,
    play,
    revealFigure: () => startFigure(0),
    idle,
    exit,
    setOnScreen,
    revert: () => {
      entrance = null;
      figureIn = null;
      drift = null;
      ctx.revert();
    },
  };
}
