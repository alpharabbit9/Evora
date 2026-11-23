import { expect, test } from '@playwright/test';

import { E2E_PRODUCT, SHIPPING_ADDRESS } from '../fixtures';
import {
  API,
  addFixtureToBag,
  runWorkerOnce,
  sentMail,
  signInAsAdmin,
  signUp,
} from '../support/helpers';

/**
 * PRD §7's first acceptance criterion, end to end and in one browser: browse a published
 * product, choose a variant, add it to the bag, check out with cash on delivery, and follow the
 * order to "shipped" with the tracking an administrator entered. Along the way it checks what
 * only the whole stack can show: stock really moved, the receipt really left through the
 * outbox, and another customer cannot open the order by its URL.
 */
test('a customer buys a jacket and follows it to shipped', async ({ page, browser }) => {
  // ── Browse and add ────────────────────────────────────────────────────────────────────
  const email = await signUp(page);
  await page.goto('/shop');
  await page.getByRole('link', { name: new RegExp(E2E_PRODUCT.name) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/products/${E2E_PRODUCT.slug}`));
  await expect(page.getByRole('heading', { level: 1, name: E2E_PRODUCT.name })).toBeVisible();

  await addFixtureToBag(page, 'M');

  // ── Bag ───────────────────────────────────────────────────────────────────────────────
  await page.goto('/cart');
  await expect(page.getByText(E2E_PRODUCT.name).first()).toBeVisible();
  const summary = page.getByRole('complementary', { name: 'Summary' });
  await expect(summary).toContainText('4,500');
  await summary.getByRole('link', { name: 'Checkout' }).click();

  // ── Checkout (cash on delivery) ───────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel('Full name').fill(SHIPPING_ADDRESS.recipientName);
  await page.getByLabel('Phone').fill(SHIPPING_ADDRESS.phone);
  await page.getByLabel('Address', { exact: true }).fill(SHIPPING_ADDRESS.line1);
  await page.getByRole('textbox', { name: 'City' }).fill(SHIPPING_ADDRESS.city);
  await page.getByLabel('Postal code').fill(SHIPPING_ADDRESS.postalCode);

  // The server prices the order (delivery for Dhaka included) before it can be placed.
  const placeOrder = page.getByRole('button', { name: 'Place order' });
  await expect(placeOrder).toBeEnabled();
  await expect(page.getByText('Total', { exact: true })).toBeVisible();
  await placeOrder.click();

  // ── Confirmation reads the persisted order ────────────────────────────────────────────
  await expect(page).toHaveURL(/\/orders\/[^/?]+\?placed=1/);
  await expect(page.getByText('Thank you. Your order is placed.')).toBeVisible();
  const orderId = new URL(page.url()).pathname.split('/').pop() ?? '';
  const orderNumber = (await page
    .getByText('Order number')
    .locator('xpath=following-sibling::dd')
    .textContent())!.trim();
  expect(orderNumber).toMatch(/\S+/);
  await expect(page.getByText('Pay on delivery')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order progress' })).toBeVisible();

  // The account page lists it.
  await page.goto('/account');
  await expect(page.getByText(orderNumber)).toBeVisible();

  // ── Another customer cannot open it ───────────────────────────────────────────────────
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUp(stranger);
  await stranger.goto(`/orders/${orderId}`);
  await expect(stranger.getByText("We couldn't load this order")).toBeVisible();
  await expect(stranger.getByText(orderNumber)).toHaveCount(0);
  const direct = await stranger.request.get(`${API}/orders/${orderId}`);
  expect(direct.status()).toBe(404);
  await strangerContext.close();

  // ── An administrator prepares and ships it ────────────────────────────────────────────
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInAsAdmin(admin);

  // Stock was claimed by the order: 5 → 4 for size M, with a movement recorded.
  const inventory = await admin.request.get(`${API}/admin/inventory?q=E2E-FJ-M`);
  expect(inventory.ok()).toBe(true);
  const rows = ((await inventory.json()) as { data: { sku: string; stockQuantity: number }[] })
    .data;
  expect(rows.find((row) => row.sku === 'E2E-FJ-M')?.stockQuantity).toBe(4);

  await admin.goto(`/admin/orders/${orderId}`);
  await expect(admin.getByText(orderNumber).first()).toBeVisible();

  await admin.getByRole('button', { name: 'Start preparing' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Start preparing' }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);

  await admin.getByRole('button', { name: 'Mark as shipped' }).click();
  const ship = admin.getByRole('dialog');
  await ship.getByLabel('Carrier (optional)').fill('Pathao');
  await ship.getByLabel('Tracking number (optional)').fill('PTH-E2E-0001');
  await ship.getByRole('button', { name: 'Mark as shipped' }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  await expect(admin.getByRole('button', { name: 'Mark as delivered' })).toBeVisible();
  await adminContext.close();

  // ── The customer sees where it is ─────────────────────────────────────────────────────
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText('On its way').first()).toBeVisible();
  await expect(page.getByText('Pathao · PTH-E2E-0001')).toBeVisible();

  // ── The receipt and shipping emails leave through the outbox ──────────────────────────
  runWorkerOnce();
  const mine = sentMail().filter((mail) => mail.body.includes(email));
  expect(mine.length).toBeGreaterThanOrEqual(2);
  expect(mine.some((mail) => mail.body.includes(orderNumber))).toBe(true);
});
