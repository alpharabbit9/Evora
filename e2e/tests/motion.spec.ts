import { expect, test, type Page } from "@playwright/test";

/**
 * The home page's motion system (plan.md Phase 5): each section has its own entrance, the
 * continuous hero loops stop while the hero is off screen, and every new entrance has a
 * reduced-motion branch.
 *
 * - Dark Edit: each photo wipes up into its frame (`ClipReveal`, GSAP `clip-path`), and the clip
 *   is cleared once it lands. Reduced motion: no clip, a fade.
 * - Service strip: `items={false}`, so its items never move.
 * - Footer wordmark: each letter rises out of its mask once. Reduced motion: the word fades.
 * - Hero: the idle drift and the autoplay hold while the hero is scrolled out of view.
 * - Recent Arrivals rail: the garments slide in along the rod once (`.arrival-enter`, GSAP x),
 *   and their CSS sway pauses while the rail is off screen. Reduced motion: no slide, no sway.
 */

const EDIT = 'section[aria-labelledby="dark-edit-heading"]';
const STRIP = 'section[aria-labelledby="service-strip-heading"]';
const FOOTER_WORDMARK = 'footer a[aria-label="EVORA home"]';
const ACTIVE_SLIDE = '[aria-roledescription="slide"]:not([inert])';
const RAIL = ".arrivals-rail";

/** The play state of every garment's sway keyframes (not its transitions), deduplicated. */
function swayStates(page: Page): Promise<string[]> {
  return page
    .locator(`${RAIL} .arrival-sway`)
    .evaluateAll((els) => [
      ...new Set(
        els.map(
          (el) =>
            el
              .getAnimations()
              .find((a) => (a as CSSAnimation).animationName === "arrival-sway")
              ?.playState ?? "none",
        ),
      ),
    ]);
}

/** Each garment entrance wrapper's horizontal offset (px) and opacity. */
function railEntrance(page: Page): Promise<{ x: number; opacity: number }[]> {
  return page.locator(`${RAIL} .arrival-enter`).evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        x: Math.round(new DOMMatrixReadOnly(cs.transform).m41),
        opacity: Number(cs.opacity),
      };
    }),
  );
}

async function scrollTo(
  page: Page,
  selector: string,
  offset: number,
): Promise<void> {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    [selector, offset] as const,
  );
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
}

/** The vertical translation of each footer letter, in px (0 at rest). */
function letterOffsets(page: Page): Promise<number[]> {
  return page.locator(`${FOOTER_WORDMARK} [data-char]`).evaluateAll((chars) =>
    chars.map((c) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      return Math.round(m.m42);
    }),
  );
}

/** The active slide's idle-drift offset and its title. */
function heroState(page: Page): Promise<{ drift: number; title: string }> {
  return page.locator(ACTIVE_SLIDE).evaluate((slide) => {
    const drift = slide.querySelector('[data-hero="drift"]');
    const m = new DOMMatrixReadOnly(
      drift ? getComputedStyle(drift).transform : "none",
    );
    return {
      drift: Math.round(m.m42 * 100) / 100,
      title: slide.querySelector("h2")?.textContent?.trim() ?? "",
    };
  });
}

test.describe("home page motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.describe("with motion", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });

    test("Dark Edit photos wipe up into their frames, then the clip is cleared", async ({
      page,
    }) => {
      await page.goto("/");
      const clip = page.locator(`${EDIT} [data-reveal="clip"]`).first();
      await clip.waitFor({ state: "attached" });
      // Not yet scrolled to: fully clipped from the top.
      await expect
        .poll(() => clip.evaluate((el) => getComputedStyle(el).clipPath))
        .toBe("inset(100% 0% 0%)");

      await scrollTo(page, `${EDIT} ul`, 500);
      await expect
        .poll(() => clip.evaluate((el) => getComputedStyle(el).clipPath), {
          timeout: 4000,
        })
        .toBe("none");
      await expect
        .poll(() =>
          clip.evaluate(
            (el) => getComputedStyle(el.closest("li") ?? el).opacity,
          ),
        )
        .toBe("1");
    });

    test("the service strip items never move", async ({ page }) => {
      await page.goto("/");
      await scrollTo(page, STRIP, 700);
      const item = page.locator(`${STRIP} li`).first();
      for (let i = 0; i < 4; i++) {
        const style = await item.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { opacity: cs.opacity, transform: cs.transform };
        });
        expect(style).toEqual({ opacity: "1", transform: "none" });
        await page.waitForTimeout(120);
      }
    });

    test("the footer wordmark letters rise once and settle in place", async ({
      page,
    }) => {
      await page.goto("/");
      // Before the footer is reached, every letter waits below its mask.
      const before = await letterOffsets(page);
      expect(before).toHaveLength(5);
      for (const y of before) expect(y).toBeGreaterThan(0);

      await scrollToBottom(page);
      await expect
        .poll(() => letterOffsets(page), { timeout: 4000 })
        .toEqual([0, 0, 0, 0, 0]);
      await expect(page.locator(FOOTER_WORDMARK)).toHaveAccessibleName(
        "EVORA home",
      );
    });

    test("the hero drift and autoplay hold while the hero is off screen", async ({
      page,
    }) => {
      await page.goto("/");
      await page.mouse.move(1435, 5); // off the hero: hovering it pauses the autoplay
      await page.waitForTimeout(2500);

      await scrollToBottom(page);
      await page.waitForTimeout(500);
      const off = await heroState(page);
      // Longer than one autoplay interval (8s).
      await page.waitForTimeout(9000);
      expect(await heroState(page)).toEqual(off);

      // Back on screen, the drift moves again.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect
        .poll(async () => (await heroState(page)).drift, { timeout: 4000 })
        .not.toBe(off.drift);
    });

    test("the rail's garments slide in along the rod, and the sway pauses off screen", async ({
      page,
    }) => {
      await page.goto("/");
      // Below the fold on load: waiting to slide in from the right, sway paused.
      await expect
        .poll(async () => (await railEntrance(page))[0])
        .toEqual({ x: 60, opacity: 0 });
      const before = await railEntrance(page);
      expect(before.length).toBeGreaterThan(0);
      for (const item of before) expect(item).toEqual({ x: 60, opacity: 0 });
      await expect.poll(() => swayStates(page)).toEqual(["paused"]);

      await scrollTo(page, RAIL, 400);
      await expect
        .poll(() => railEntrance(page), { timeout: 4000 })
        .toEqual(before.map(() => ({ x: 0, opacity: 1 })));
      await expect.poll(() => swayStates(page)).toEqual(["running"]);

      await scrollToBottom(page);
      await expect.poll(() => swayStates(page)).toEqual(["paused"]);
      expect(
        await page
          .locator(RAIL)
          .evaluate((el) => el.classList.contains("is-offscreen")),
      ).toBe(true);
    });
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("the rail fades in without sliding, and never sways", async ({
      page,
    }) => {
      await page.goto("/");
      // Waiting below the fold: hidden, but never offset.
      await expect
        .poll(async () => (await railEntrance(page))[0])
        .toEqual({ x: 0, opacity: 0 });
      const count = (await railEntrance(page)).length;
      await scrollTo(page, RAIL, 400);
      await expect
        .poll(() => railEntrance(page), { timeout: 4000 })
        .toEqual(Array.from({ length: count }, () => ({ x: 0, opacity: 1 })));
      expect(await swayStates(page)).toEqual(["none"]);
    });

    test("nothing is clipped or translated; the footer word fades", async ({
      page,
    }) => {
      await page.goto("/");
      const clip = page.locator(`${EDIT} [data-reveal="clip"]`).first();
      await clip.waitFor({ state: "attached" });
      expect(await clip.evaluate((el) => getComputedStyle(el).clipPath)).toBe(
        "none",
      );

      await scrollTo(page, `${EDIT} ul`, 500);
      await expect
        .poll(() =>
          clip.evaluate(
            (el) => getComputedStyle(el.closest("li") ?? el).opacity,
          ),
        )
        .toBe("1");
      expect(await clip.evaluate((el) => getComputedStyle(el).clipPath)).toBe(
        "none",
      );

      expect(await letterOffsets(page)).toEqual([0, 0, 0, 0, 0]);
      await scrollToBottom(page);
      await expect
        .poll(() =>
          page
            .locator(FOOTER_WORDMARK)
            .evaluate((el) => getComputedStyle(el).opacity),
        )
        .toBe("1");
      expect(await letterOffsets(page)).toEqual([0, 0, 0, 0, 0]);
    });
  });
});
