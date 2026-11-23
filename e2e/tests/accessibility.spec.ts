import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { E2E_PRODUCT } from '../fixtures';
import { addFixtureToBag, signUp } from '../support/helpers';

/**
 * Automated WCAG 2.1 A/AA checks with axe on the pages a purchase passes through (PRD §5:
 * keyboard operation, semantic structure, labels, contrast). axe finds roughly a third of real
 * problems; it is a floor, not a substitute for a manual keyboard and screen-reader pass.
 *
 * Only `serious` and `critical` findings fail the run, so the suite stays a gate rather than a
 * to-do list; anything lesser is attached to the report.
 */
async function audit(page: Page, label: string): Promise<void> {
  // Let entrance animations settle so contrast is measured on the final colours.
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  await test.info().attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  expect(
    blocking.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    })),
    `${label}: serious or critical accessibility violations`,
  ).toEqual([]);
}

/** Scrolls the page through once, so every scroll reveal and lazy image has run. */
async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The pages a visitor reaches without an account, audited in each theme and motion mode. */
const PUBLIC_PAGES = [
  ['home', '/'],
  ['shop', '/shop'],
  ['product', `/products/${E2E_PRODUCT.slug}`],
] as const;

test.describe('accessibility', () => {
  test('public pages', async ({ page }) => {
    for (const [label, path] of [
      ['home', '/'],
      ['shop', '/shop'],
      ['product', `/products/${E2E_PRODUCT.slug}`],
      ['sign-in', '/auth?mode=signin'],
      ['sign-up', '/auth?mode=signup'],
    ] as const) {
      await test.step(label, async () => {
        await page.goto(path);
        await audit(page, label);
      });
    }
  });

  test('bag and checkout', async ({ page }) => {
    await signUp(page);
    await addFixtureToBag(page, 'L');

    await page.goto('/cart');
    await expect(page.getByRole('link', { name: 'Checkout' })).toBeVisible();
    await audit(page, 'bag');

    await page.goto('/checkout');
    await expect(page.getByLabel('Full name')).toBeVisible();
    await audit(page, 'checkout');
  });
});

/**
 * plan.md 9.7: the same audit in the dark site theme (the theme toggle's choice, kept by
 * next-themes in localStorage) and with motion on. The dark theme flips every token, so its
 * contrast is its own check; the light theme's dark islands (the Dark Edit, the campaign) are
 * covered by the light runs above. With motion on, the audit runs after a scroll through the
 * page, once every reveal has finished, so contrast is read on the settled colours.
 */
test.describe('accessibility in the dark theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('theme', 'dark');
    });
  });

  test('public pages', async ({ page }) => {
    for (const [label, path] of PUBLIC_PAGES) {
      await test.step(label, async () => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        await scrollThrough(page);
        await audit(page, `dark-${label}`);
      });
    }
  });
});

test.describe('accessibility with motion on', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  for (const theme of ['light', 'dark'] as const) {
    test(`the home page, ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => {
        window.localStorage.setItem('theme', value);
      }, theme);
      await page.goto('/');
      await scrollThrough(page);
      // The reveals run 0.6–0.9s; give the last of them time to finish.
      await page.waitForTimeout(1500);
      await audit(page, `motion-${theme}-home`);
    });
  }
});

/**
 * A keyboard pass through the home page: Tab from the top until focus leaves the footer. Every
 * stop must be a visible control (not hidden, not inside an inert or aria-hidden subtree), it
 * must show a focus indicator (an outline or a ring), and focus must reach the footer, so no
 * part of the page traps it.
 */
test.describe('keyboard', () => {
  for (const motion of ['reduce', 'no-preference'] as const) {
    test(`every stop on the home page is visible and shows focus (${motion} motion)`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ reducedMotion: motion });
      const page = await context.newPage();
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.locator('body').focus();

      const problems: string[] = [];
      const seen = new Set<string>();
      let reachedFooter = false;

      for (let step = 0; step < 200 && !reachedFooter; step += 1) {
        await page.keyboard.press('Tab');
        // Lenis eases the page to the focused control; read the stop once it is in view.
        await page.waitForTimeout(motion === 'reduce' ? 60 : 250);
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const name =
            el.getAttribute('aria-label') ??
            (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
          return {
            id: `${el.tagName.toLowerCase()} "${name}" ${el.getAttribute('href') ?? ''}`,
            inFooter: Boolean(el.closest('footer')),
            sized: box.width >= 1 && box.height >= 1,
            hidden:
              style.visibility === 'hidden' ||
              Boolean(el.closest('[inert], [aria-hidden="true"]')) ||
              Number(style.opacity) === 0,
            // On the control or inside it: the rail's garment links ring their label
            // (`.arrival-link:focus-visible .arrival-label`) and turn the garment to the front.
            indicator: [el, ...el.querySelectorAll('*')].some((node) => {
              const s = getComputedStyle(node);
              return (
                (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
                s.boxShadow !== 'none'
              );
            }),
            last:
              el.closest('footer') !== null &&
              [...document.querySelectorAll('footer a[href], footer button')].at(-1) === el,
          };
        });
        if (!stop) continue;
        seen.add(stop.id);
        if (!stop.sized || stop.hidden) problems.push(`${stop.id}: focused while not visible`);
        if (!stop.indicator) problems.push(`${stop.id}: no focus indicator`);
        if (stop.last) reachedFooter = true;
      }

      expect(problems, 'keyboard stops').toEqual([]);
      expect(reachedFooter, `focus reached the footer's last link after ${seen.size} stops`).toBe(
        true,
      );
      await context.close();
    });
  }
});
