import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * plan.md Phase 7 (micro-interactions), on the home page:
 * - press feedback: the shared CSS `press` dip on the hero CTA and controls and the campaign
 *   CTA, and no dip under reduced motion;
 * - the hero's autoplay hairline fills, and holds while the hero is hovered;
 * - the rail's proximity sway: `--near` rises beside a mouse pointer, stays 0 under it, and
 *   eases back to 0 when the pointer leaves; never under reduced motion.
 *
 * The header badge pop needs a signed-in cart and is checked by the Phase 7 helper script
 * (`.playwright-mcp/phase7/headless.cjs`), which stubs the session and cart.
 */

const HERO = '[aria-roledescription="carousel"]';
const HAIRLINE = `${HERO} div[aria-hidden="true"].h-px`;

/**
 * `scale` to two decimals, with a scale that has eased back to 1 read as `none`: under load
 * the 100ms/160ms transitions can still be in their last fraction of a percent when read.
 */
function settledScale(value: string): string {
  if (value === "none") return value;
  const rounded = Math.round(Number.parseFloat(value) * 100) / 100;
  return rounded === 1 ? "none" : String(rounded);
}

/** Holds the mouse down on `target`, reads its `scale`, then releases off it (no click). */
async function pressScale(
  page: Page,
  target: Locator,
): Promise<{ held: string; released: string }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const held = settledScale(
    await target.evaluate((el) => getComputedStyle(el).scale),
  );
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const released = settledScale(
    await target.evaluate((el) => getComputedStyle(el).scale),
  );
  return { held, released };
}

function hairlineFill(page: Page): Promise<number> {
  return page.locator(`${HAIRLINE} > div`).evaluate((el) => {
    const m = getComputedStyle(el).transform;
    return m === "none" ? 1 : new DOMMatrixReadOnly(m).a;
  });
}

function nearValues(page: Page): Promise<number[]> {
  return page
    .locator(".arrival")
    .evaluateAll((els) =>
      els.map((el) =>
        Number(getComputedStyle(el).getPropertyValue("--near") || 0),
      ),
    );
}

/** Puts the pointer on the rail, beside (below) garment `index`, over no garment. */
async function pointBeside(page: Page, index: number): Promise<void> {
  const list = page.locator(".arrivals-list");
  await list.scrollIntoViewIfNeeded();
  // Let the entrance land.
  await page.waitForTimeout(1500);
  const box = await list.boundingBox();
  const slot = await page.locator(".arrival").nth(index).boundingBox();
  if (!box || !slot) throw new Error("rail has no box");
  await page.mouse.move(slot.x + slot.width / 2, box.y + box.height - 12, {
    steps: 4,
  });
}

test.describe("home page micro-interactions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.describe("with motion", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });

    test("CTAs and hero controls dip while pressed, and come back", async ({
      page,
    }) => {
      await page.goto("/");
      const cta = page.locator('[data-hero="cta"] a').first();
      await cta.waitFor();
      expect(await pressScale(page, cta)).toEqual({
        held: "0.97",
        released: "none",
      });
      expect(
        await pressScale(
          page,
          page.getByRole("button", { name: "Next slide" }),
        ),
      ).toEqual({ held: "0.92", released: "none" });

      const campaign = page
        .locator('a[href="/shop?category=outerwear"]')
        .first();
      await campaign.scrollIntoViewIfNeeded();
      await expect(campaign).toBeVisible();
      await page.waitForTimeout(1200); // its reveal
      expect(await pressScale(page, campaign)).toEqual({
        held: "0.97",
        released: "none",
      });
    });

    test("the autoplay hairline fills, and holds while the hero is hovered", async ({
      page,
    }) => {
      await page.goto("/");
      await page.mouse.move(1435, 5); // off the hero
      await page.locator(HAIRLINE).waitFor();
      const start = await hairlineFill(page);
      await page.waitForTimeout(1000);
      expect(await hairlineFill(page)).toBeGreaterThan(start + 0.05);

      const hero = await page.locator(HERO).boundingBox();
      if (!hero) throw new Error("hero has no box");
      await page.mouse.move(hero.x + hero.width / 2, hero.y + hero.height / 3);
      await page.waitForTimeout(300);
      const held = await hairlineFill(page);
      await page.waitForTimeout(1000);
      expect(await hairlineFill(page)).toBeCloseTo(held, 2);
    });

    test("garments beside the mouse swing wider, the one under it does not", async ({
      page,
    }) => {
      await page.goto("/");
      await pointBeside(page, 3);
      await expect
        .poll(async () => (await nearValues(page))[3], { timeout: 3000 })
        .toBeGreaterThan(0.9);
      const beside = await nearValues(page);
      // Far away: at (or easing back to) 0 from the pointer's path in.
      expect(beside[0]).toBeLessThan(0.02);
      expect(beside[2]).toBeGreaterThan(0.3);

      // On garment 3 itself: it turns to face front and stays at 0; its neighbours rise.
      const hit = await page.locator(".arrival-hit").nth(3).boundingBox();
      if (!hit) throw new Error("garment has no box");
      await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2, {
        steps: 4,
      });
      await expect
        .poll(async () => (await nearValues(page))[3], { timeout: 3000 })
        .toBeLessThan(0.02);
      expect((await nearValues(page))[4]).toBeGreaterThan(0.3);

      // Leaving the rail eases every garment back to 0.
      await page.mouse.move(2, 2, { steps: 4 });
      await expect
        .poll(async () => Math.max(...(await nearValues(page))), {
          timeout: 3000,
        })
        .toBeLessThan(0.02);
    });
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("nothing dips, and the rail ignores the pointer", async ({ page }) => {
      await page.goto("/");
      const cta = page.locator('[data-hero="cta"] a').first();
      await cta.waitFor();
      expect((await pressScale(page, cta)).held).toBe("none");

      await pointBeside(page, 3);
      await page.waitForTimeout(1000);
      expect(Math.max(...(await nearValues(page)))).toBe(0);
    });
  });
});

/**
 * The header's theme control (plan.md 9.5 moved its sun/moon spin from Framer Motion to CSS
 * keyframes, `.theme-icon` in globals.css). Each theme shows exactly its own icon, after a
 * reload too, and the switch spins one out as the other spins in.
 */
test.describe("the theme control's icon", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("shows the sun in light, the moon in dark, and spins between them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const toggle = page.locator("header").getByRole("button", { name: "Dark theme" });
    const sun = toggle.locator(".theme-icon-sun");
    const moon = toggle.locator(".theme-icon-moon");
    const opacity = (icon: Locator) =>
      icon.evaluate((el) => Number(getComputedStyle(el).opacity));

    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await opacity(sun)).toBe(1);
    expect(await opacity(moon)).toBe(0);

    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Mid-switch both icons are animating (the 500ms spin runs inside the 900ms reveal).
    await expect
      .poll(() => moon.evaluate((el) => el.getAnimations().length))
      .toBeGreaterThan(0);
    await expect.poll(() => opacity(moon), { timeout: 3000 }).toBe(1);
    await expect.poll(() => opacity(sun)).toBe(0);

    // The choice survives a reload, and the icon is right from first paint, with no spin.
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    expect(await opacity(moon)).toBe(1);
    expect(await opacity(sun)).toBe(0);
  });
});
