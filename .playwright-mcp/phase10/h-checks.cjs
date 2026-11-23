// plan.md H checklist items with no current e2e coverage. Test harness only.
// - Rail: the garments span at least 70% of the rod at 1440 (the old rail's e2e check went with
//   it in ADR 0027).
// - Loops pause off screen: the hero autoplay hairline and the rail's sway hold while scrolled away.
//
// Run from e2e/: node ../.playwright-mcp/phase10/h-checks.cjs
// Expects the verify build on :3000 and the dev API on :4000.
const { chromium } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));

const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const out = {};

  // Rail span, CSS rail (the WebGL layer draws the same boxes; ?rail=css keeps the DOM photos).
  {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    await page.goto(BASE + '/?rail=css', { waitUntil: 'networkidle' });
    const rail = page.locator('.arrivals-list');
    await rail.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    out.railSpan = await rail.evaluate((list) => {
      const rod = getComputedStyle(list, '::before');
      const box = list.getBoundingClientRect();
      const rodLeft = box.left + parseFloat(rod.left);
      const rodWidth = parseFloat(rod.width);
      const garments = [...list.querySelectorAll('.arrival')].map((a) => a.getBoundingClientRect());
      const left = Math.min(...garments.map((g) => g.left));
      const right = Math.max(...garments.map((g) => g.right));
      return {
        garments: garments.length,
        rodWidth: Math.round(rodWidth),
        garmentSpan: Math.round(right - left),
        share: +((right - left) / rodWidth).toFixed(3),
        rodLeft: Math.round(rodLeft),
      };
    });
    await page.close();
  }

  // Loops off screen.
  {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.mouse.move(5, 895); // off the hero, so hover does not pause autoplay
    const hairline = () =>
      page.evaluate(() => {
        const fill = document.querySelector('[aria-roledescription="carousel"] .h-px > div');
        return fill ? getComputedStyle(fill).transform : null;
      });
    const sway = () =>
      page.evaluate(() => {
        const s = document.querySelector('.arrival-sway');
        return s ? getComputedStyle(s).rotate : null;
      });
    const onA = await hairline();
    await page.waitForTimeout(1000);
    const onB = await hairline();
    // Scroll to the bottom: the hero and the rail are both off screen.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1500);
    const offHairA = await hairline();
    const offSwayA = await sway();
    const offRail = await page.evaluate(() =>
      document.querySelector('.arrivals-rail')?.classList.contains('is-offscreen'),
    );
    await page.waitForTimeout(1500);
    const offHairB = await hairline();
    const offSwayB = await sway();
    out.loops = {
      hairlineMovesOnScreen: onA !== onB,
      hairlineHeldOffScreen: offHairA === offHairB,
      railMarkedOffscreen: offRail,
      swayHeldOffScreen: offSwayA === offSwayB,
      readings: { onA, onB, offHairA, offHairB, offSwayA, offSwayB },
    };
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
