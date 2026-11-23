import { expect, test } from '@playwright/test';

import { signUp } from '../support/helpers';

/**
 * The header's menu panel and primary navigation (plan.md Phase 2). The panel stays mounted so
 * it can animate out, which makes "closed" a property to prove rather than assume: hidden,
 * inert, and out of the tab order.
 */
test.describe('header navigation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the primary link for the page being viewed is marked current', async ({ page }) => {
    await page.goto('/collections/men');
    const primary = page.getByRole('navigation', { name: 'Primary' });

    await expect(primary.getByRole('link', { name: 'Men', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(primary.locator('[aria-current="page"]')).toHaveCount(1);

    // A filtered shop page marks its own link; any other category falls back to "Shop all".
    await page.goto('/shop?category=accessories');
    await expect(primary.locator('[aria-current="page"]')).toHaveText('Accessories');
    await page.goto('/shop?category=jackets');
    await expect(primary.locator('[aria-current="page"]')).toHaveText('Shop all');
  });

  test('Escape closes the menu and returns focus to its button', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#site-menu-panel');
    await expect(panel).toBeHidden();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Site menu' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('a click outside the header closes the menu', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Site menu' })).toBeVisible();

    await page.mouse.click(700, 880);
    await expect(page.locator('#site-menu-panel')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('the footer offers account links that match the session', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Create account' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'My account' })).toHaveCount(0);

    await signUp(page);
    await page.goto('/');
    await expect(footer.getByRole('link', { name: 'My account' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await expect(footer.getByRole('link', { name: 'Create account' })).toHaveCount(0);
  });

  test('a closed menu is not in the tab order', async ({ page }) => {
    await page.goto('/');
    // Open and close once, so the panel has been rendered visible before.
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#site-menu-panel')).toBeHidden();
    await expect(page.locator('#site-menu-panel')).toHaveJSProperty('inert', true);

    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
    await page.keyboard.press('Tab');
    const focusedInPanel = await page.evaluate(
      () => document.activeElement?.closest('#site-menu-panel') !== null,
    );
    expect(focusedInPanel).toBe(false);
  });
});
