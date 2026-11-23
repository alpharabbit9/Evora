import { devices, expect, test, type Page } from "@playwright/test";

/**
 * plan.md Phase 8 (responsive refinement) and 2.6 (the header hiding on scroll), on the home
 * page:
 * - no sideways overflow from 360 to 1920;
 * - on a touch phone, every control is a 44px target (a `tap-target` hit area counts);
 * - the rail snaps a garment to the centre and fades only the edges with more rail beyond;
 * - the Dark Edit is three columns at 768, with the lead tile two by two;
 * - the header hides on scroll-down past the hero, comes back on scroll-up, and never hides
 *   under reduced motion or on a page without a hero.
 */

const { defaultBrowserType: _browser, ...PIXEL } = devices["Pixel 7"];

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
}

for (const width of [360, 390, 768, 1024, 1280, 1440, 1920]) {
  test(`no sideways overflow at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await scrollThrough(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test.describe("on a touch phone", () => {
  test.use({
    ...PIXEL,
    viewport: { width: 390, height: 844 },
    contextOptions: { reducedMotion: "no-preference" },
  });

  test("every control in the header, hero and footer is a 44px target", async ({
    page,
  }) => {
    await page.goto("/");
    // Let the page's entrance finish: it covers the page while it runs.
    await page.locator('[data-hero="cta"] a').first().waitFor();
    await page.waitForTimeout(1500);
    const misses = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'header a[href], header button, [aria-roledescription="carousel"] a[href], [aria-roledescription="carousel"] button, footer a[href]',
        ),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 1 &&
          getComputedStyle(el).visibility !== "hidden" &&
          !el.closest("[inert]")
        );
      });
      const out: string[] = [];
      for (const el of controls) {
        if (el.closest("footer")) {
          el.scrollIntoView({ block: "center" });
          await wait(800);
        }
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // The centre and the four edge midpoints of the 44px square: a rounded control's
        // corners are outside its hit area, but WCAG sizes a target by its bounding box.
        const probes: [number, number][] = [
          [0, 0],
          [-21, 0],
          [21, 0],
          [0, -21],
          [0, 21],
        ];
        for (const [dx, dy] of probes) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (!hit || !(hit === el || el.contains(hit))) {
            out.push(
              `${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""} at ${String(dx)},${String(dy)}: hit ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}` : "nothing"}`,
            );
            break;
          }
        }
      }
      return out;
    });
    expect(misses).toEqual([]);
  });

  test("the rail snaps a garment to the centre and fades only the edges with more rail", async ({
    page,
  }) => {
    await page.goto("/");
    const rail = page.locator(".arrivals-rail");
    await rail.scrollIntoViewIfNeeded();
    await expect(rail.locator(".arrival").first()).toBeVisible();

    const read = () =>
      rail.evaluate((el) => {
        const s = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const middle = box.left + box.width / 2;
        return {
          start: s.getPropertyValue("--fade-start").trim(),
          end: s.getPropertyValue("--fade-end").trim(),
          offCentre: Math.min(
            ...[...el.querySelectorAll(".arrival")].map((a) => {
              const b = a.getBoundingClientRect();
              return Math.abs(b.left + b.width / 2 - middle);
            }),
          ),
        };
      });

    await expect.poll(async () => (await read()).end).toBe("40px");
    expect((await read()).start).toBe("0px");

    await rail.evaluate((el) =>
      el.scrollBy({ left: 150, behavior: "instant" }),
    );
    await expect
      .poll(async () => (await read()).offCentre, { timeout: 3000 })
      .toBeLessThan(2);
    expect(await read()).toMatchObject({ start: "40px", end: "40px" });

    await rail.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(async () => (await read()).end).toBe("0px");
  });
});

test("the Dark Edit is three columns at 768, with the lead tile two by two", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  // The e2e catalog seeds a single product, and the edit needs nine for its full layout: pad
  // the product list with copies of whatever the API returns (distinct ids, same product).
  //
  // The server renders the edit with its products already fetched (plan.md 9.1), out of this
  // test's reach. Moving the page's clock a minute ahead makes that server copy stale (the
  // query client's `staleTime` is 30s), so the grid refetches in the browser, where the
  // response can be padded. Only `Date` moves; timers and animation frames run as usual.
  await page.clock.setFixedTime(Date.now() + 60_000);
  await page.route(/\/api\/v1\/products\?/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      data: unknown[] | { items: unknown[] };
    };
    const list = Array.isArray(body.data) ? body.data : body.data.items;
    const first = list[0] as { id: string } | undefined;
    if (first) {
      const padded = Array.from({ length: 9 }, (_, i) => ({
        ...first,
        id: `${first.id}-${String(i)}`,
      }));
      list.splice(0, list.length, ...padded);
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  const grid = page
    .locator('section[aria-labelledby="dark-edit-heading"] ul')
    .first();
  await grid.scrollIntoViewIfNeeded();
  await expect(grid.locator(":scope > li")).toHaveCount(9);
  const shape = await grid.evaluate((ul) => {
    const items = [...ul.children].map((li) => li.getBoundingClientRect());
    const lead = items[0]!;
    return {
      columns: getComputedStyle(ul).gridTemplateColumns.split(" ").length,
      // Two cards beside the lead, both within its height.
      beside: items
        .slice(1)
        .filter((r) => r.left > lead.right && r.top < lead.bottom).length,
    };
  });
  expect(shape).toEqual({ columns: 3, beside: 2 });
});

test.describe("the header on scroll", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("hides on scroll-down past the hero and comes back on scroll-up", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const header = page.locator("header").first();
    await page.mouse.move(640, 400);

    // Still over the hero: stays.
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(600);
    await expect(header).not.toHaveAttribute("data-hidden");

    // Past it: hides, and slides fully out of view.
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 250);
      await page.waitForTimeout(80);
    }
    await expect(header).toHaveAttribute("data-hidden", "true");
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().bottom), {
        timeout: 3000,
      })
      .toBeLessThanOrEqual(1);

    // Any scroll up: back.
    await page.mouse.wheel(0, -120);
    await expect(header).not.toHaveAttribute("data-hidden");

    // Keyboard focus inside it brings it back while it is hidden (CSS `has-[:focus-visible]`).
    await page.mouse.wheel(0, 600);
    await expect(header).toHaveAttribute("data-hidden", "true");
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      if (await header.evaluate((el) => el.contains(document.activeElement)))
        break;
    }
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().top), {
        timeout: 3000,
      })
      .toBeGreaterThanOrEqual(0);
  });

  test("never hides on a page without a hero", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/shop");
    await page.mouse.move(640, 400);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    await expect(page.locator("header").first()).not.toHaveAttribute(
      "data-hidden",
    );
  });
});

test.describe("the header under reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("never hides", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.mouse.move(640, 400);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    await expect(page.locator("header").first()).not.toHaveAttribute(
      "data-hidden",
    );
  });
});

for (const width of [390, 768, 1440]) {
  test(`the assistant launcher never covers the hero's controls at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/");
    const launcher = page.locator("[data-assistant-launcher]");
    // The e2e stack runs the assistant (fake LLM), so the launcher is on the page.
    await expect(launcher).toBeVisible();
    const overlaps = await page.evaluate(() => {
      const box = document
        .querySelector("[data-assistant-launcher]")!
        .getBoundingClientRect();
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          '[aria-roledescription="carousel"] button, [aria-roledescription="carousel"] a[href]',
        ),
      ];
      return controls
        .filter((el) => {
          const r = el.getBoundingClientRect();
          // The 44px hit area around it, not just its painted box.
          const pad = Math.max(0, (44 - r.width) / 2);
          const padY = Math.max(0, (44 - r.height) / 2);
          return (
            r.width > 0 &&
            r.left - pad < box.right &&
            r.right + pad > box.left &&
            r.top - padY < box.bottom &&
            r.bottom + padY > box.top
          );
        })
        .map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim());
    });
    expect(overlaps).toEqual([]);
  });
}
