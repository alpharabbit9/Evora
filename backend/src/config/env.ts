import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail fast on boot rather than discovering a missing secret mid-request.
 * Secrets are read from the environment only; nothing here is logged.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),

    // `min(32)` alone let the .env.example placeholder through — it is 36 characters long,
    // so a fresh clone booted with a publicly known signing secret and nothing complained.
    // The refinement closes that: a secret must not look like a leftover placeholder.
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
      .refine(
        (value) => !/replace|placeholder|changeme|example|your-secret/i.test(value),
        'BETTER_AUTH_SECRET is still a placeholder. Generate one with: openssl rand -base64 32',
      ),
    BETTER_AUTH_URL: z.url(),

    FRONTEND_ORIGIN: z.url(),

    /**
     * Integration tests connect here, never to DATABASE_URL — `npm run test:db` truncates
     * tables, so pointing it at the development database would wipe local work. Optional so
     * the unit suite and `npm run dev` do not require it.
     */
    DATABASE_URL_TEST: z.string().optional(),

    /**
     * Where product image binaries live (`src/lib/storage.ts`). `filesystem` writes under
     * MEDIA_ROOT and exists for local development only — production must use `s3`
     * (any S3-compatible store: AWS S3, R2, MinIO).
     */
    STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
    MEDIA_ROOT: z.string().min(1).default('.data/media'),

    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    /**
     * Public base URL that product image keys are appended to (`src/lib/media.ts`). With the
     * filesystem driver the API serves MEDIA_ROOT itself at `/media`, so it defaults to
     * `${BETTER_AUTH_URL}/media`. With s3 it is the bucket's public/CDN origin and must be set.
     */
    MEDIA_PUBLIC_URL: z.url().optional(),

    /**
     * The single store currency (ADR 0008 amendment). Catalog rows carry no currency, so the
     * API labels every price with this. Only BDT is accepted: a different value would relabel
     * existing poisha amounts without converting them.
     */
    STORE_CURRENCY: z.enum(['BDT']).default('BDT'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.STORAGE_DRIVER === 'filesystem') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'The filesystem storage driver is for development only; use s3 in production',
      });
    }

    if (value.STORAGE_DRIVER === 's3') {
      for (const key of [
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'MEDIA_PUBLIC_URL',
      ] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print field names and issues only — never the offending values.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
export const isProduction = env.NODE_ENV === 'production';
