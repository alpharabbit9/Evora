import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Production boot rules for email and image storage (`src/config/env.ts`). env.ts validates on
 * import, so each case stubs the environment and imports a fresh copy. Every key the rules read
 * is stubbed, so a developer's own `.env` (which `dotenv/config` loads, without overriding) cannot
 * change the outcome.
 */
const BASE = {
  NODE_ENV: 'production',
  VERCEL: '',
  DATABASE_URL: 'postgresql://user:pass@db.internal:5432/commercecore',
  BETTER_AUTH_SECRET: 'k3J9vQ2mX7pL5rT8wZ1nB4cF6hD0sA2gE9uY3iO7',
  BETTER_AUTH_URL: 'https://shop.test',
  FRONTEND_ORIGIN: 'https://shop.test',
  AUTH_COOKIE_DOMAIN: '',
  EMAIL_FROM: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  S3_BUCKET: '',
  S3_ACCESS_KEY_ID: '',
  S3_SECRET_ACCESS_KEY: '',
  MEDIA_PUBLIC_URL: '',
  GROQ_API_KEY: '',
  OPENAI_API_KEY: '',
  SSLCOMMERZ_STORE_ID: '',
  SSLCOMMERZ_STORE_PASSWORD: '',
} as const;

async function loadEnv(overrides: Record<string, string>) {
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
    // An empty value would fail the schema for some keys, so "unset" really is unset.
    vi.stubEnv(key, value === '' ? undefined : value);
  }
  vi.resetModules();
  return import('../src/config/env.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('production email and storage settings', () => {
  it('refuses the development drivers, naming both ways out', async () => {
    await expect(
      loadEnv({ EMAIL_DRIVER: 'filesystem', STORAGE_DRIVER: 'filesystem' }),
    ).rejects.toThrow(/EMAIL_DRIVER: .*use smtp in production, or EMAIL_DRIVER=disabled/);
    await expect(
      loadEnv({ EMAIL_DRIVER: 'filesystem', STORAGE_DRIVER: 'filesystem' }),
    ).rejects.toThrow(/STORAGE_DRIVER: .*use s3 in production, or STORAGE_DRIVER=disabled/);
  });

  it('boots with email and storage switched off on purpose', async () => {
    // EMAIL_FROM stays at its `.localhost` default, which a sending driver would refuse.
    const { env } = await loadEnv({ EMAIL_DRIVER: 'disabled', STORAGE_DRIVER: 'disabled' });

    expect(env.EMAIL_DRIVER).toBe('disabled');
    expect(env.STORAGE_DRIVER).toBe('disabled');
    expect(env.EMAIL_FROM).toMatch(/\.localhost>$/);
  });

  it('still refuses a .localhost sender once email is really sent', async () => {
    await expect(
      loadEnv({ EMAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.test', STORAGE_DRIVER: 'disabled' }),
    ).rejects.toThrow(/EMAIL_FROM: Set EMAIL_FROM to an address on a domain you send from/);
  });

  it('still requires the bucket settings when storage is s3', async () => {
    await expect(loadEnv({ EMAIL_DRIVER: 'disabled', STORAGE_DRIVER: 's3' })).rejects.toThrow(
      /S3_BUCKET is required when STORAGE_DRIVER=s3/,
    );
  });

  it('refuses a driver name it does not know', async () => {
    await expect(loadEnv({ EMAIL_DRIVER: 'off', STORAGE_DRIVER: 'disabled' })).rejects.toThrow(
      /EMAIL_DRIVER/,
    );
  });
});
