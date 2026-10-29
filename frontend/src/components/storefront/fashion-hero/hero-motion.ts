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
 * | `[data-hero=figure]`     | GSAP           | x, opacity                                  |
 * | `[data-hero=drift]`      | GSAP           | y (idle drift only)                         |
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
  /** Plays the incoming sequence, then settles into the idle drift. */
  enter: (direction: HeroDirection) => void;
  /** Starts the idle drift without an entrance (the server-rendered first slide). */
  idle: () => void;
  /** Plays the outgoing sequence once, from wherever the slide currently is. */
  exit: (direction: HeroDirection, onComplete: () => void) => void;
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

/** Every layer that fades as a whole under reduced motion. */
const FADE_LAYERS = [
  SELECTOR.headline,
  SELECTOR.figure,
  SELECTOR.lines,
  SELECTOR.rule,
  SELECTOR.meta,
  SELECTOR.ctas,
].join();

export function createSlideMotion(
  root: HTMLElement,
  { reducedMotion }: { reducedMotion: boolean },
): SlideMotion {
  const ctx = gsap.context(() => {}, root);
  const q = gsap.utils.selector(root);

  let entrance: gsap.core.Timeline | null = null;
  let drift: gsap.core.Tween | null = null;
  let exiting = false;

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
      });
    });
  };

  const enter = (direction: HeroDirection) => {
    ctx.add(() => {
      const tl = gsap.timeline({ onComplete: idle });

      if (reducedMotion) {
        // Opacity only: no travel, no masks.
        tl.from(q(FADE_LAYERS), { autoAlpha: 0, duration: 0.45, ease: 'none' }, 0.1);
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
        // The model walks in along the direction of travel.
        .from(
          q(SELECTOR.figure),
          { x: -64 * direction, autoAlpha: 0, duration: 1, ease: EASE.glide },
          0.36,
        )
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

  const exit = (direction: HeroDirection, onComplete: () => void) => {
    if (exiting) return;
    exiting = true;

    ctx.add(() => {
      // Freeze whatever is mid-flight; the exit tweens start from the current values.
      entrance?.kill();
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
    idle,
    exit,
    revert: () => {
      entrance = null;
      drift = null;
      ctx.revert();
    },
  };
}
