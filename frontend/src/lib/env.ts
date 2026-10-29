import { z } from 'zod';

/**
 * Only NEXT_PUBLIC_* variables exist in the browser bundle, and Next inlines them at
 * build time — so they must be referenced literally, not via a dynamic lookup.
 * Nothing secret belongs in this file.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid public environment configuration:\n${issues}`);
}

export const publicEnv = parsed.data;

/** The API is versioned; keep the prefix in one place (API_SPEC.md §1). */
export const API_BASE_URL = `${publicEnv.NEXT_PUBLIC_API_URL}/api/v1`;
