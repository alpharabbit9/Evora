import { expect, test } from '@playwright/test';

import { WEB_URL } from '../env';
import { E2E_PRODUCT } from '../fixtures';
import { API, signUp } from '../support/helpers';

/**
 * Who may see what, checked from a browser (ADR 0009, ADR 0014). Hiding a control is not
 * authorization, so each refusal is checked twice: on the page, and by calling the API directly
 * with the same session.
 */
test.describe('access control', () => {
  test('a guest is sent to sign in, and back again afterwards', async ({ page }) => {
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/auth\?/);
    expect(new URL(page.url()).searchParams.get('mode')).toBe('signin');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/cart');

    // "Add to bag" as a guest asks for an account, then returns to the product.
    await page.goto(`/products/${E2E_PRODUCT.slug}`);
    await page.getByRole('group', { name: /^Size/ }).getByText('L', { exact: true }).click();
    await page.getByRole('button', { name: 'Add to bag' }).click();
    await expect(page).toHaveURL(/\/auth\?/);

    const next = new URL(page.url()).searchParams.get('next');
    expect(next).toBe(`/products/${E2E_PRODUCT.slug}`);
    await signUp(page, { next: next ?? '/' });
    await expect(page).toHaveURL(new RegExp(`/products/${E2E_PRODUCT.slug}$`));
  });

  test('a sign-in link cannot send the visitor to another site', async ({ page }) => {
    await signUp(page, { next: 'https://evil.example/steal' });
    expect(new URL(page.url()).origin).toBe(WEB_URL);
  });

  test('a customer is refused the admin dashboard and the admin API', async ({ page }) => {
    await signUp(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /admin/i })).toHaveCount(0);

    const orders = await page.request.get(`${API}/admin/orders`);
    expect(orders.status()).toBe(403);
    const customers = await page.request.get(`${API}/admin/customers`);
    expect(customers.status()).toBe(403);
  });

  test('a guest is refused the private API', async ({ request }) => {
    expect((await request.get(`${API}/cart`)).status()).toBe(401);
    expect((await request.get(`${API}/me`)).status()).toBe(401);
    expect((await request.get(`${API}/admin/orders`)).status()).toBe(401);
  });

  test('a state change from another origin is refused', async ({ page }) => {
    await signUp(page);
    // The session cookie rides along, but the Origin is not the storefront's.
    const response = await page.request.post(`${API}/cart/items`, {
      headers: { origin: 'https://evil.example' },
      data: { variantId: 'anything', quantity: 1 },
    });
    expect(response.status()).toBe(403);
  });
});
