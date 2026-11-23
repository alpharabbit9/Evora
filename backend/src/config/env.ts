import 'dotenv/config';
import { z } from 'zod';

import { cookieTopologyProblem } from './deployment.js';

/** An optional string where an empty value (as `.env.example` ships it) counts as unset. */
function optionalString() {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  );
}

/** Text a copied `.env.example` value still contains; a secret like that is publicly known. */
const PLACEHOLDER = /replace|placeholder|changeme|example|your-secret/i;

/** An optional shared secret: unset when empty, otherwise long and not a placeholder. */
function optionalSecret(name: string, minLength: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .trim()
      .min(minLength, `${name} must be at least ${minLength} characters`)
      .refine(
        (value) => !PLACEHOLDER.test(value),
        `${name} is still a placeholder. Generate one with: openssl rand -base64 32`,
      )
      .optional(),
  );
}

/**
 * Vercel sets `VERCEL=1` in every build and function it runs (its system environment).
 * `vercel dev` on a laptop sets it too, with `VERCEL_ENV=development`; that is not a deployment.
 */
const onVercel = process.env.VERCEL === '1' && process.env.VERCEL_ENV !== 'development';

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
        (value) => !PLACEHOLDER.test(value),
        'BETTER_AUTH_SECRET is still a placeholder. Generate one with: openssl rand -base64 32',
      ),
    BETTER_AUTH_URL: z.url(),

    FRONTEND_ORIGIN: z.url(),

    /**
     * The parent domain the session cookie is scoped to when the storefront and the API are
     * on sibling subdomains (`shop.example.com`, `api.example.com` → `example.com`). Leave unset
     * when the API is served under the storefront's own host, which is preferred (ADR 0024).
     */
    // Empty counts as unset: `.env.example` ships the key with no value.
    AUTH_COOKIE_DOMAIN: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .trim()
        .regex(
          /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
          'AUTH_COOKIE_DOMAIN must be a domain such as example.com',
        )
        .optional(),
    ),

    /**
     * Integration tests connect here, never to DATABASE_URL — `npm run test:db` truncates
     * tables, so pointing it at the development database would wipe local work. Optional so
     * the unit suite and `npm run dev` do not require it.
     */
    DATABASE_URL_TEST: z.string().optional(),

    /**
     * Where product image binaries live (`src/lib/storage.ts`). `filesystem` writes under
     * MEDIA_ROOT and exists for local development only — production must use `s3`
     * (any S3-compatible store: AWS S3, R2, MinIO) or say `disabled` on purpose. `disabled` runs
     * the store without product images: no bucket, nothing served, and the admin cannot attach
     * an image (it would point at a file that cannot exist).
     */
    STORAGE_DRIVER: z.enum(['filesystem', 's3', 'disabled']).default('filesystem'),
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

    /**
     * Online payment (ADR 0019). Without a store id and password the store simply does not offer
     * it: cash on delivery keeps working and no button leads nowhere.
     */
    SSLCOMMERZ_STORE_ID: z.string().optional(),
    SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
    SSLCOMMERZ_BASE_URL: z.url().default('https://sandbox.sslcommerz.com'),
    /**
     * Where the provider and the customer's browser reach this API. Defaults to BETTER_AUTH_URL.
     * A notification cannot reach localhost, so set a public tunnel here to receive them in dev.
     */
    PAYMENT_CALLBACK_BASE_URL: z.url().optional(),

    /**
     * Email delivery (ADR 0021). `filesystem` writes each message as an `.eml` file under
     * MAIL_ROOT and sends nothing — development only, refused in production. `smtp` hands it to
     * any SMTP relay; which provider sits behind it is still open (PRD §9). `disabled` is the
     * explicit "no relay yet": every email job fails permanently (status DEAD, visible to staff)
     * instead of pretending to send, and orders and accounts work as they do in an email outage.
     */
    EMAIL_DRIVER: z.enum(['filesystem', 'smtp', 'disabled']).default('filesystem'),
    MAIL_ROOT: z.string().min(1).default('.data/mail'),
    /** `Name <address>`; the address's domain also names the stable Message-ID. */
    EMAIL_FROM: z.string().min(3).default('CommerceCore <no-reply@commercecore.localhost>'),
    STORE_NAME: z.string().trim().min(1).max(80).default('CommerceCore'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
    /** `true` for implicit TLS (port 465); otherwise STARTTLS is required on 587. */
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /**
     * Who receives low-stock and payment-review alerts, comma-separated. Unset: every active
     * administrator.
     */
    STAFF_ALERT_EMAILS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.email())),

    /** The worker (`src/worker.ts`). Defaults suit one small store. */
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** How often the payment and refund sweep runs. */
    RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60 * 1000)
      .default(5 * 60 * 1000),

    /**
     * Shopping assistant (ADR 0025). Groq writes the answers; OpenAI, when set, makes the embeddings
     * and answers when Groq cannot. Groq alone works (keyword search, no fallback). With no chat
     * provider at all the assistant is not offered: the widget stays hidden and nothing else
     * changes. Empty counts as unset.
     */
    GROQ_API_KEY: optionalString(),
    GROQ_CHAT_MODEL: optionalString(),
    GROQ_BASE_URL: z.url().default('https://api.groq.com/openai/v1'),
    OPENAI_API_KEY: optionalString(),
    OPENAI_CHAT_MODEL: optionalString(),
    /** The vector columns are `vector(1536)`; another model needs a migration (ADR 0025). */
    OPENAI_EMBEDDING_MODEL: z.string().trim().min(1).default('text-embedding-3-small'),
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    /** Tokens one signed-in customer may spend per UTC day, input and output together. */
    ASSISTANT_DAILY_TOKEN_BUDGET: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(10_000_000)
      .default(60_000),
    /** Messages a guest (by hashed IP) may send per UTC day. */
    ASSISTANT_GUEST_DAILY_MESSAGES: z.coerce.number().int().min(1).max(1_000).default(20),
    /** How often the worker refreshes the assistant's search index. */
    ASSISTANT_INDEX_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60 * 1000)
      .default(15 * 60 * 1000),

    /**
     * Serverless hosting (ADR 0028). A function cannot run the long-lived worker, so on Vercel the
     * outbox is drained by a schedule, `GET /api/v1/internal/outbox/drain` with
     * `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends exactly that), and by the API itself
     * right after each successful write. Unset, the drain endpoint does not exist.
     */
    CRON_SECRET: optionalSecret('CRON_SECRET', 16),
    /**
     * Drain the outbox after each successful write, inside the same function invocation. On by
     * default on Vercel, where nothing else would send a password-reset email within minutes; off
     * elsewhere, where the worker process does it.
     */
    OUTBOX_DRAIN_AFTER_WRITES: z
      .preprocess(
        (value) =>
          typeof value === 'string' && value.trim() !== ''
            ? value.trim()
            : onVercel
              ? 'true'
              : 'false',
        z.enum(['true', 'false']),
      )
      .transform((value) => value === 'true'),
    /**
     * Shared with the storefront when it forwards `/api/*` here (ADR 0028). With it, the API
     * believes the visitor address the storefront passes along, so rate limits and the
     * assistant's guest allowance count each visitor, not the storefront's own address.
     * Unset, that header is ignored.
     */
    API_PROXY_SECRET: optionalSecret('API_PROXY_SECRET', 32),
  })
  .superRefine((value, ctx) => {
    if (onVercel && value.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message:
          'Set NODE_ENV=production in the Vercel project: development mode is never right there',
      });
    }

    if (onVercel && !value.CRON_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['CRON_SECRET'],
        message:
          'CRON_SECRET is required on Vercel: the scheduled outbox drain authenticates with it ' +
          '(generate one with: openssl rand -base64 32)',
      });
    }

    if (value.GROQ_API_KEY && !value.GROQ_CHAT_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_CHAT_MODEL'],
        message:
          'GROQ_CHAT_MODEL is required when GROQ_API_KEY is set (a Groq model with tool use)',
      });
    }

    if (value.OPENAI_API_KEY && !value.OPENAI_CHAT_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_CHAT_MODEL'],
        message: 'OPENAI_CHAT_MODEL is required when OPENAI_API_KEY is set',
      });
    }

    if (value.NODE_ENV === 'production') {
      for (const key of ['GROQ_BASE_URL', 'OPENAI_BASE_URL'] as const) {
        if (!value[key].startsWith('https://')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} must use https in production`,
          });
        }
      }
    }

    if (Boolean(value.SSLCOMMERZ_STORE_ID) !== Boolean(value.SSLCOMMERZ_STORE_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SSLCOMMERZ_STORE_PASSWORD'],
        message: 'Set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD together, or neither',
      });
    }

    // Live payments are out of scope until provider and legal review (PRD §2).
    if (new URL(value.SSLCOMMERZ_BASE_URL).hostname === 'securepay.sslcommerz.com') {
      ctx.addIssue({
        code: 'custom',
        path: ['SSLCOMMERZ_BASE_URL'],
        message: 'Live SSLCOMMERZ is refused: only the sandbox is approved (PRD §2, §8)',
      });
    }

    if (value.NODE_ENV === 'production' && !value.SSLCOMMERZ_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['SSLCOMMERZ_BASE_URL'],
        message: 'SSLCOMMERZ_BASE_URL must use https in production',
      });
    }

    if (value.NODE_ENV === 'production' && value.EMAIL_DRIVER === 'filesystem') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_DRIVER'],
        message:
          'The filesystem email driver sends nothing; use smtp in production, or ' +
          'EMAIL_DRIVER=disabled to run without email on purpose',
      });
    }

    if (value.EMAIL_DRIVER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp',
      });
    }

    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_PASSWORD'],
        message: 'Set SMTP_USER and SMTP_PASSWORD together, or neither',
      });
    }

    if (!/<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(value.EMAIL_FROM.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM must be an address or "Name <address>"',
      });
    }

    // No message leaves with EMAIL_DRIVER=disabled, so its sender address does not matter yet.
    if (
      value.NODE_ENV === 'production' &&
      value.EMAIL_DRIVER !== 'disabled' &&
      /\.localhost>?$/.test(value.EMAIL_FROM.trim())
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'Set EMAIL_FROM to an address on a domain you send from',
      });
    }

    if (value.NODE_ENV === 'production') {
      const problem = cookieTopologyProblem({
        frontendOrigin: value.FRONTEND_ORIGIN,
        authUrl: value.BETTER_AUTH_URL,
        cookieDomain: value.AUTH_COOKIE_DOMAIN,
      });
      if (problem) {
        ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: problem });
      }
    }

    if (value.NODE_ENV === 'production' && value.STORAGE_DRIVER === 'filesystem') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message:
          'The filesystem storage driver is for development only; use s3 in production, or ' +
          'STORAGE_DRIVER=disabled to run without product images on purpose',
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
