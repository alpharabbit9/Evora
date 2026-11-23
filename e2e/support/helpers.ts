import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { API_URL, BACKEND_DIR, MAIL_ROOT, backendEnv } from '../env';
import { CUSTOMER_PASSWORD, E2E_ADMIN, E2E_PRODUCT, uniqueEmail } from '../fixtures';

export const API = `${API_URL}/api/v1`;

/** Registers a customer through the real sign-up form and waits until the session exists. */
export async function signUp(
  page: Page,
  options: { email?: string; name?: string; next?: string } = {},
): Promise<string> {
  const email = options.email ?? uniqueEmail('shopper');
  const next = options.next ? `&next=${encodeURIComponent(options.next)}` : '';

  await page.goto(`/auth?mode=signup${next}`);
  const form = page.getByRole('region', { name: 'Create account' });
  await form.getByLabel('Full name').fill(options.name ?? 'E2E Shopper');
  await form.getByLabel('Email address').fill(email);
  await form.getByLabel('Password', { exact: true }).fill(CUSTOMER_PASSWORD);
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).not.toHaveURL(/\/auth/);

  return email;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth?mode=signin');
  const form = page.getByRole('region', { name: 'Sign in' });
  await form.getByLabel('Email address').fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/auth/);
}

export async function signInAsAdmin(page: Page): Promise<void> {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
}

/** On the fixture product's page: pick a size and add it to the bag. */
export async function addFixtureToBag(page: Page, size = 'M'): Promise<void> {
  await page.goto(`/products/${E2E_PRODUCT.slug}`);
  await page.getByRole('group', { name: /^Size/ }).getByText(size, { exact: true }).click();
  await page.getByRole('button', { name: 'Add to bag' }).click();
  await expect(page.getByText('Added to your bag')).toBeVisible();
}

/**
 * Runs one worker pass (`npm run jobs:run-once`) against the E2E database, so queued emails are
 * written as `.eml` files under MAIL_ROOT — the same code path a scheduler would trigger.
 */
export function runWorkerOnce(): void {
  execFileSync('npx', ['tsx', 'src/worker.ts', '--once'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...backendEnv() },
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
}

/** Every message the filesystem transport wrote, newest last. */
export function sentMail(): { file: string; body: string }[] {
  let files: string[];
  try {
    files = readdirSync(MAIL_ROOT, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  return files
    .filter((file) => file.endsWith('.eml'))
    .map((file) => ({ file, body: readFileSync(path.join(MAIL_ROOT, file), 'utf8') }));
}
