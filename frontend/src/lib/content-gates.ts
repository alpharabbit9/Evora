/**
 * Whether the storefront may show content that is not yet true for customers: sample reviews,
 * and answers or promises still waiting on a decided store policy (PRD §9 "Decisions still
 * required"). ADR 0026.
 *
 * Development shows it, so layouts can be built and reviewed against realistic copy. A
 * production build hides it unless `NEXT_PUBLIC_SHOW_UNCONFIRMED_CONTENT=true` — for a staging
 * review, never for the live store. The value is inlined at build time (`NEXT_PUBLIC_*`), so
 * Server and Client Components agree and nothing is decided per request.
 */
export const SHOW_UNCONFIRMED_CONTENT =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_SHOW_UNCONFIRMED_CONTENT === 'true';

/** Content whose wording is a statement of store policy. */
export type PolicyBacked = {
  /** `placeholder` until the wording matches a decided store policy. */
  readonly policy: 'placeholder' | 'confirmed';
};

/** The entries a visitor may see: all of them while unconfirmed content is allowed. */
export function visiblePolicyContent<T extends PolicyBacked>(items: readonly T[]): readonly T[] {
  return SHOW_UNCONFIRMED_CONTENT ? items : items.filter((item) => item.policy === 'confirmed');
}
