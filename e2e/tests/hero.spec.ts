import { expect, test, type Page } from '@playwright/test';

/**
 * The home-page campaign hero (plan.md Phase 3). Each slide's entrance waits for its model
 * image to be decoded, so the walk-in never plays on an empty figure box and the contact
 * shadow never shows on its own; and each slide's oversized word stays readable behind the
 * model.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

const SLIDE_COUNT = 3;

type EntranceSample = {
  /** Milliseconds from the click until the model was fully opaque, or null if it never was. */
  visibleAfter: number | null;
  /** Frames in which the figure layer showed while its image had not loaded. */
  emptyFrames: number;
};

/** Clicks Next and follows the incoming slide's model frame by frame for `budget` ms. */
async function nextSlideEntrance(page: Page, budget: number): Promise<EntranceSample> {
  return page.evaluate(async (limit) => {
    const incoming = () =>
      [...document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]')].find(
        (slide) => !slide.inert,
      );
    // Product of every opacity from the image up to its slide: what actually reaches the screen.
    const effectiveOpacity = (el: Element, root: Element) => {
      let value = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        value *= Number(getComputedStyle(node).opacity);
        if (node === root) break;
      }
      return value;
    };

    const before = incoming();
    const next = document.querySelector<HTMLButtonElement>('button[aria-label="Next slide"]');
    if (!next) throw new Error('No "Next slide" button');
    const t0 = performance.now();
    next.click();

    let visibleAfter: number | null = null;
    let emptyFrames = 0;
    while (performance.now() - t0 < limit) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const slide = incoming();
      if (!slide || slide === before) continue;
      const figure = slide.querySelector('[data-hero="figure"]');
      const img = slide.querySelector<HTMLImageElement>('[data-hero="drift"] img');
      if (!figure || !img) continue;
      const loaded = img.complete && img.naturalWidth > 0;
      if (!loaded && effectiveOpacity(figure, slide) > 0.05) emptyFrames += 1;
      if (visibleAfter === null && loaded && effectiveOpacity(img, slide) >= 0.99) {
        visibleAfter = Math.round(performance.now() - t0);
      }
    }
    return { visibleAfter, emptyFrames };
  }, budget);
}

/** Letters of the incoming slide's word that the model hides completely (alpha > 200). */
async function hiddenLetters(page: Page): Promise<{ word: string; hidden: string[] }> {
  return page.evaluate(async () => {
    const slide = [
      ...document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'),
    ].find((element) => !element.inert);
    const img = slide?.querySelector<HTMLImageElement>('[data-hero="drift"] img');
    if (!slide || !img) throw new Error('No active slide image');
    await img.decode();

    // The picture as drawn: `object-contain object-bottom` inside the image box.
    const box = img.getBoundingClientRect();
    const ratio = img.naturalWidth / img.naturalHeight;
    let width = box.width;
    let height = box.width / ratio;
    if (height > box.height) {
      height = box.height;
      width = height * ratio;
    }
    const left = box.left + (box.width - width) / 2;
    const top = box.bottom - height;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context');
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const opaque = (x: number, y: number) => {
      const px = Math.round(x - left);
      const py = Math.round(y - top);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
      return (pixels[(py * canvas.width + px) * 4 + 3] ?? 0) > 200;
    };

    const chars = [...slide.querySelectorAll<HTMLElement>('[data-hero="char"]')];
    const hidden: string[] = [];
    for (const char of chars) {
      const rect = char.getBoundingClientRect();
      let covered = 0;
      let samples = 0;
      // A 14 × 8 grid over the glyph's ink band (the middle 70% of the em box).
      for (let i = 0; i < 14; i += 1) {
        for (let j = 0; j < 8; j += 1) {
          samples += 1;
          const x = rect.left + (rect.width * (i + 0.5)) / 14;
          const y = rect.top + rect.height * (0.15 + (0.7 * (j + 0.5)) / 8);
          if (opaque(x, y)) covered += 1;
        }
      }
      if (covered / samples > 0.8) hidden.push(char.textContent ?? '');
    }
    return { word: chars.map((char) => char.textContent ?? '').join(''), hidden };
  });
}

/** Loads the home page and waits until the following slide's image has been fetched ahead. */
async function openHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Featured collections' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('home-page hero', () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.name} (${String(viewport.width)}px)`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test.describe('with motion', () => {
        test.use({ contextOptions: { reducedMotion: 'no-preference' } });

        test('every slide change shows the model within 1.5s, never an empty figure', async ({
          page,
        }) => {
          await openHome(page);
          for (let step = 0; step < SLIDE_COUNT; step += 1) {
            const sample = await nextSlideEntrance(page, 2_500);
            expect(sample.emptyFrames, `slide change ${String(step + 1)}`).toBe(0);
            expect(sample.visibleAfter, `slide change ${String(step + 1)}`).not.toBeNull();
            expect(sample.visibleAfter ?? Infinity).toBeLessThanOrEqual(1_500);
          }
        });

        // The slide indicators are reported on their own. They used to animate the active
        // bar's width, which nudged its neighbours (a CLS of ~0.00004); since plan.md 7.5 they
        // are fixed-size segments, so both areas must be zero.
        test('the slide layers do not shift layout while they load and change', async ({
          page,
        }) => {
          await page.addInitScript(() => {
            type Shift = { value: number; area: 'slides' | 'indicators' | 'outside' };
            const shifts: Shift[] = [];
            (window as unknown as { __heroShifts: Shift[] }).__heroShifts = shifts;
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries() as (PerformanceEntry & {
                value: number;
                sources?: { node?: Node | null }[];
              })[]) {
                const hero = document.querySelector('[aria-roledescription="carousel"]');
                const indicators = document.querySelector('[aria-label="Choose a slide"]');
                for (const { node } of entry.sources ?? []) {
                  if (node == null || hero?.contains(node) !== true) {
                    shifts.push({ value: entry.value, area: 'outside' });
                  } else if (indicators?.contains(node) === true) {
                    shifts.push({ value: entry.value, area: 'indicators' });
                  } else {
                    shifts.push({ value: entry.value, area: 'slides' });
                  }
                }
              }
            }).observe({ type: 'layout-shift', buffered: true });
          });
          await openHome(page);
          await nextSlideEntrance(page, 1_800);

          const total = await page.evaluate(() => {
            const shifts = (
              window as unknown as {
                __heroShifts: { value: number; area: 'slides' | 'indicators' | 'outside' }[];
              }
            ).__heroShifts;
            const sum = (area: string) =>
              shifts.filter((shift) => shift.area === area).reduce((s, x) => s + x.value, 0);
            return { slides: sum('slides'), indicators: sum('indicators') };
          });
          test.info().annotations.push({
            type: 'indicator layout shift',
            description: String(total.indicators),
          });
          expect(total.slides).toBe(0);
          expect(total.indicators).toBe(0);
        });
      });

      // The suite's default context prefers reduced motion: the entrance is a short fade.
      test('under reduced motion the model still appears on every slide', async ({ page }) => {
        await openHome(page);
        for (let step = 0; step < SLIDE_COUNT; step += 1) {
          const sample = await nextSlideEntrance(page, 1_500);
          expect(sample.emptyFrames).toBe(0);
          expect(sample.visibleAfter ?? Infinity).toBeLessThanOrEqual(1_000);
        }
      });

      test('the model hides at most one letter of each slide word', async ({ page }) => {
        await openHome(page);
        await page.getByRole('button', { name: 'Pause slideshow' }).click();
        for (let step = 0; step < SLIDE_COUNT; step += 1) {
          if (step > 0) {
            await page.getByRole('button', { name: 'Next slide' }).click();
            // Reduced motion: the outgoing frame fades in 0.3s, the incoming one in 0.55s.
            await expect(page.locator('[aria-roledescription="slide"]')).toHaveCount(1);
          }
          const { word, hidden } = await hiddenLetters(page);
          expect(hidden.length, `${word} hides ${hidden.join('') || 'nothing'}`).toBeLessThanOrEqual(
            1,
          );
        }
      });
    });
  }
});
