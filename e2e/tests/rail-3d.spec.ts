import { devices, expect, test, type Page } from "@playwright/test";

/**
 * plan.md Phase 6 (shipped, ADR 0027 §7): the Recent Arrivals rail's WebGL layer.
 *
 * It is on by default, but only for a mouse or trackpad, without reduced motion, with WebGL2,
 * once the rail is near. Everyone else keeps the CSS rail, which is also what comes back if the
 * WebGL context is lost. `?rail=css` turns the layer off per page load.
 */

const RAIL = ".arrivals-rail";

async function scrollToRail(page: Page): Promise<void> {
  await page.locator(".arrivals-list").scrollIntoViewIfNeeded();
}

async function domPhotoVisibility(page: Page): Promise<string> {
  return page
    .locator(`${RAIL} .arrival-cutout-side`)
    .first()
    .evaluate((el) => getComputedStyle(el).visibility);
}

function webgl2(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.createElement("canvas").getContext("webgl2") !== null,
  );
}

test.describe("recent arrivals WebGL layer", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: "no-preference" },
  });

  test("mounts for a mouse near the rail, and hides only the DOM photos", async ({
    page,
  }) => {
    await page.goto("/");
    test.skip(!(await webgl2(page)), "this browser has no WebGL2");

    // Not before the rail is near.
    await expect(page.locator(`${RAIL} canvas`)).toHaveCount(0);

    await scrollToRail(page);
    await expect(page.locator(`${RAIL} canvas`)).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.locator(RAIL)).toHaveClass(/\bis-3d\b/, {
      timeout: 15_000,
    });
    expect(await domPhotoVisibility(page)).toBe("hidden");
    // The links stay DOM: focusable, named, in place.
    await expect(page.locator(`${RAIL} .arrival-hit`).first()).toBeVisible();
  });

  test("gives the CSS rail back when the WebGL context is lost", async ({
    page,
  }) => {
    await page.goto("/");
    test.skip(!(await webgl2(page)), "this browser has no WebGL2");
    await scrollToRail(page);
    await expect(page.locator(RAIL)).toHaveClass(/\bis-3d\b/, {
      timeout: 15_000,
    });

    await page.locator(`${RAIL} canvas`).evaluate((canvas) => {
      (canvas as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext();
    });
    await expect(page.locator(`${RAIL} canvas`)).toHaveCount(0);
    await expect(page.locator(RAIL)).not.toHaveClass(/\bis-3d\b/);
    expect(await domPhotoVisibility(page)).toBe("visible");
  });

  test("?rail=css keeps the CSS rail", async ({ page }) => {
    await page.goto("/?rail=css");
    await scrollToRail(page);
    await page.waitForTimeout(1500);
    await expect(page.locator(`${RAIL} canvas`)).toHaveCount(0);
    expect(await domPhotoVisibility(page)).toBe("visible");
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("keeps the CSS rail", async ({ page }) => {
      await page.goto("/");
      await scrollToRail(page);
      await page.waitForTimeout(1500);
      await expect(page.locator(`${RAIL} canvas`)).toHaveCount(0);
      expect(await domPhotoVisibility(page)).toBe("visible");
    });
  });
});

test.describe("recent arrivals WebGL layer on a touch phone", () => {
  const { defaultBrowserType: _browser, ...pixel } = devices["Pixel 7"];
  test.use({ ...pixel, contextOptions: { reducedMotion: "no-preference" } });

  test("keeps the CSS rail", async ({ page }) => {
    await page.goto("/");
    await scrollToRail(page);
    await page.waitForTimeout(1500);
    await expect(page.locator(`${RAIL} canvas`)).toHaveCount(0);
    expect(await domPhotoVisibility(page)).toBe("visible");
  });
});
