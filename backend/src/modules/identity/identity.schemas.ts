import { z } from 'zod';

/**
 * Server-side shapes for the account endpoints (API_SPEC.md §3).
 *
 * Every object here is a `strictObject`, which is the mass-assignment guard: an unknown
 * key is a 400, not a silently dropped field. That is what makes `{"role":"ADMIN"}` on
 * `PATCH /me` an explicit refusal instead of a request that looks like it worked. Stripping
 * would also be safe, but it would hide the attempt.
 *
 * Client-side validation is UX; this is the boundary that protects the domain
 * (CLAUDE.md engineering rules). Bounds here are deliberately no looser than the CHECK
 * constraints in prisma/migrations — the database stays the final guardrail.
 */

/** `.trim()` before `.min(1)`: a field of spaces must fail here, as it does in the CHECK. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * A nullable column. On create the field may be omitted (stored as NULL) or given a
 * non-blank value; `""` is rejected rather than quietly persisted as an empty string.
 */
const optionalOnCreate = (max: number) => requiredText(max).nullable().default(null);

/** The same column on update: absent means "leave it alone", `null` means "clear it". */
const optionalOnUpdate = (max: number) => requiredText(max).nullable().optional();

/** CHECK `addresses_country_code_check`: exactly two characters, upper case. */
const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Must be a two-letter ISO country code')
  .transform((value) => value.toUpperCase());

const phone = z.string().trim().min(3).max(32);

export const updateProfileBody = z
  .strictObject({
    name: requiredText(120).optional(),
    /** `null` clears the avatar. A URL, never an upload — object storage is M3. */
    image: z.url().max(2048).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.image !== undefined,
    'Provide at least one field to update.',
  );

export type UpdateProfileInput = z.output<typeof updateProfileBody>;

export const createAddressBody = z.strictObject({
  label: optionalOnCreate(60),
  recipientName: requiredText(120),
  phone: phone.nullable().default(null),
  line1: requiredText(200),
  line2: optionalOnCreate(200),
  city: requiredText(120),
  state: optionalOnCreate(120),
  postalCode: requiredText(32),
  countryCode,
  isDefault: z.boolean().default(false),
});

export type CreateAddressInput = z.output<typeof createAddressBody>;

/** Partial update, still strict: `userId` cannot be smuggled in to move someone else's row. */
export const updateAddressBody = z
  .strictObject({
    label: optionalOnUpdate(60),
    recipientName: requiredText(120).optional(),
    phone: phone.nullable().optional(),
    line1: requiredText(200).optional(),
    line2: optionalOnUpdate(200),
    city: requiredText(120).optional(),
    state: optionalOnUpdate(120),
    postalCode: requiredText(32).optional(),
    countryCode: countryCode.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export type UpdateAddressInput = z.output<typeof updateAddressBody>;
