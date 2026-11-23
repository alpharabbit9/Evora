# ADR 0026 — Unconfirmed Storefront Content Is Hidden in Production

- **Status:** Accepted
- **Date:** 2026-11-16
- **Related:** PRD §9 "Decisions still required"; [ADR 0019](0019-online-payments-sslcommerz.md)
  (the payment methods that *are* decided); `plan.md` Phase 1

## Context
The homepage audit (`plan.md`, B3.4) found copy that customers could read but that is not true
yet:

- **Sample testimonials** under the headline "Real People. Real Style.", with a small "Sample
  reviews for preview" note beside them. The `Review` model is not built.
- **FAQ answers** marked "Placeholder — policy to be confirmed". Shipping, returns and delivery
  countries are open in PRD §9.
- **Store promises**, including "Hassle-free returns within 30 days" and "delivered on time,
  every time", in the home page's service strip (formerly the "Why shop with us?" band) and beside "Add to bag" on the product page. No
  decided policy backs them.
- **A newsletter form** that can only ever answer "not open yet". There is no subscription
  endpoint, so it asked for an email address it then dropped.

Labelling these honestly was right while the store was a prototype. A production build must not
show them at all. CLAUDE.md also rules out inert controls and fake success states.

## Decision
1. **One switch.** `frontend/src/lib/content-gates.ts` exports `SHOW_UNCONFIRMED_CONTENT`. It is
   true in development, and in a production build only when
   `NEXT_PUBLIC_SHOW_UNCONFIRMED_CONTENT=true`, which is for a staging review and never for the
   live store. It is inlined at build time, so Server and Client Components agree.
2. **Policy-backed copy declares its state.** FAQ entries and store promises carry
   `policy: 'placeholder' | 'confirmed'` (the shared `PolicyBacked` type).
   `visiblePolicyContent()` returns every entry while the switch is on, and only `confirmed` ones
   otherwise. Of the promises, payment (ADR 0019) and quality (brand copy, not a policy) are
   `confirmed`; shipping and returns are placeholders.
3. **Reviews.** The section shows only `source: 'customer'` reviews unless the switch is on, and
   renders nothing when there are none. The sample note still appears wherever samples do.
4. **Sections disappear rather than shrink to nothing.** The home page FAQ and the service strip
   (the promises) render `null` when no entry is left. The promise rows size their columns to
   the entries that remain.
5. **Newsletter.** `NEWSLETTER_ENABLED` in `subscribe.ts` (currently `false`) decides whether the
   form exists at all. While it is off, the banner announces "Letters from EVORA" as coming soon,
   with no field. Turning it on is part of shipping the subscription endpoint, not a content
   toggle.
6. **The `/faq` page is unchanged.** It keeps every answer under its own draft notice, which says
   plainly that the answers are not final. It is a page a visitor opens to read about policy, not
   a promise made in passing.

## Consequences
- A production build, and so the E2E suite and staging by default, shows a shorter homepage: no
  reviews, no FAQ section, two store promises, and the newsletter without a form. An E2E test
  asserts this.
- Confirming a policy is a content change: rewrite the line to match the decision exactly and
  mark it `confirmed` in `faqs.ts` or `benefits.ts`. Both files repeat the returns window, so
  change them together.
- Reviews return automatically once the reviews API supplies `customer` entries.

## Alternatives
- **Keep the labels in production.** Honest, but it advertises an unfinished store and still
  shows claims nobody has agreed to.
- **Delete the placeholder copy.** That loses realistic content for design work. The gate keeps
  it for development and review.
- **A runtime feature flag service.** Too much machinery for a build-time decision with one
  value per environment.
