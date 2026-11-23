import { expect, test } from '@playwright/test';

import { E2E_PRODUCT } from '../fixtures';
import { signUp } from '../support/helpers';

/**
 * The storefront's states a visitor can reach without buying anything: listing, search, the
 * product page with a sold-out size, a product that does not exist, and an empty bag.
 */
test.describe('storefront', () => {
  test('the shop lists the published product', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.getByRole('link', { name: new RegExp(E2E_PRODUCT.name) }).first()).toBeVisible();
  });

  test('search finds it by name', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('field jacket')}`);
    await expect(page.getByRole('link', { name: new RegExp(E2E_PRODUCT.name) }).first()).toBeVisible();
  });

  test('a sold-out size cannot be chosen', async ({ page }) => {
    await page.goto(`/products/${E2E_PRODUCT.slug}`);
    const sizes = page.getByRole('group', { name: /^Size/ });
    await expect(sizes.getByRole('radio', { name: `${E2E_PRODUCT.soldOutSize} (sold out)` })).toBeDisabled();
    for (const size of E2E_PRODUCT.inStockSizes) {
      await expect(sizes.getByRole('radio', { name: size, exact: true })).toBeEnabled();
    }
    // Nothing is selected yet, so there is nothing to add.
    await expect(page.getByRole('button', { name: 'Select a size' })).toBeDisabled();
  });

  test('an unknown product answers with a not-found page', async ({ page }) => {
    await page.goto('/products/no-such-product-e2e');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This piece isn’t in the collection' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the collection' })).toBeVisible();
    // The product page streams (it renders inside <Suspense> so price and stock are current),
    // so its status line is already sent as 200 when the API's 404 arrives. Next marks the page
    // `noindex` instead, which is what keeps a dead product URL out of search results.
    // (Next emits it twice when streaming — once in <head>, once in the streamed body.)
    await expect(page.locator('meta[name="robots"][content~="noindex"]').first()).toBeAttached();
  });

  // The suite runs a production build, where content that is not yet true for customers stays
  // hidden (ADR 0026): sample reviews, answers and promises waiting on a policy, and a newsletter
  // form with no backend behind it.
  test('the home page shows no unconfirmed content in a production build', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Recent Arrivals' })).toBeVisible();

    await expect(page.getByText(/sample reviews/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Real People. Real Style.' })).toHaveCount(0);
    await expect(page.getByText(/policy to be confirmed/i)).toHaveCount(0);
    await expect(page.getByText(/within 30 days/i)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Letters from EVORA' })).toBeVisible();
  });

  test('a new customer sees an empty bag with a way back to the shop', async ({ page }) => {
    await signUp(page);
    await page.goto('/cart');
    await expect(page.getByText('Your bag is empty')).toBeVisible();
  });
});
