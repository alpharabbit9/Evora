import { expect, test, type Page } from '@playwright/test';

/**
 * The home page's section redesign (plan.md Phase 4): the chapter order, the Dark Edit as a
 * dark island, the service strip and campaign without their template decoration, and no
 * horizontal overflow at the widths the plan checks.
 *
 * The Recent Arrivals section is not covered here: Phase 4's rail tasks (4.6–4.8) were superseded
 * by the turntable (ADR 0027), which owns its own checks.
 */

/** Scrolls the page through once, so every scroll reveal and lazy image has run. */
async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
}

test.describe('home page sections', () => {
  test('the chapters run in order, with the Dark Edit as a dark island', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await scrollThrough(page);

    const order = await page
      .locator('main section[aria-labelledby]')
      .evaluateAll((sections) => sections.map((s) => s.getAttribute('aria-labelledby')));
    // Reviews and the FAQ are absent in a production build until real content exists
    // (ADR 0026); everything that is shown keeps this relative order.
    const expected = [
      'recent-arrivals-heading',
      'dark-edit-heading',
      'campaign-banner-heading',
      'customer-reviews-heading',
      'service-strip-heading',
      'newsletter-heading',
      'faq-heading',
    ];
    expect(order).toEqual(expected.filter((id) => order.includes(id)));
    expect(order).toEqual(
      expect.arrayContaining([
        'recent-arrivals-heading',
        'dark-edit-heading',
        'campaign-banner-heading',
        'service-strip-heading',
      ]),
    );

    const edit = page.locator('section[aria-labelledby="dark-edit-heading"]');
    await expect(edit).toHaveClass(/\bdark\b/);
    await expect(edit.getByRole('heading', { level: 2 })).toHaveText(
      'The Dark Edit, built for the after hours',
    );
    await expect(edit.getByRole('link', { name: 'Shop the edit' })).toHaveAttribute(
      'href',
      '/shop',
    );

    // The service strip has no icons, and the campaign no filler tagline.
    await expect(
      page.locator('section[aria-labelledby="service-strip-heading"] svg'),
    ).toHaveCount(0);
    await expect(page.getByText('Elevated looks.')).toHaveCount(0);
  });

  for (const width of [390, 768, 1280, 1440]) {
    test(`no horizontal overflow at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await scrollThrough(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });
  }
});
