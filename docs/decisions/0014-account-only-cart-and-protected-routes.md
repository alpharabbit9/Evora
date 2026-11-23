# ADR 0014 — Account-Only Cart and Protected Storefront Routes

- **Status:** Accepted
- **Date:** 2026-11-01
- **Supersedes in part:** [ADR 0012](0012-public-catalog-api-and-cart-ownership.md) decisions 5 and 6
  (guest cart credential, merge), and the guest-cart lines of PRD §2, §3 and FR-02
- **Related:** [ADR 0009](0009-identity-authorization-and-rate-limiting.md), [ADR 0016](0016-wishlist.md)

## Context
The product owner asked that only signed-in customers can reach their profile, add to the
wishlist or add to the bag, and that a signed-out click on "Add to bag" or the wishlist goes to
sign-in. The PRD and ADR 0012 had specified the opposite for the cart: an anonymous guest cart
behind an httpOnly token, merged into the account on sign-in. This ADR records the change of
requirement so the code, the PRD and ADR 0012 no longer disagree silently.

Hiding a button is not authorization (CLAUDE.md), so the rule has to hold at the API as well as
in the storefront.

## Decision
1. **The cart belongs to an account.** `requireAuth` is applied to the whole `/api/v1/cart`
   router, as it is to `/me` and `/orders`. Every cart endpoint answers `401 UNAUTHENTICATED`
   without a session, including `GET /cart`, which used to return an empty cart. Guest tokens are
   no longer issued.
2. **Existing guest carts are not lost.** Guest carts made before this change (30-day expiry)
   are still folded into the account on the customer's next signed-in cart request, exactly as
   ADR 0012 decision 6 describes. The guest token code is reduced to reading and clearing the
   cookie for that merge.
3. **Three layers for a signed-in-only page** — `/account`, `/cart`, `/wishlist`:
   - `src/proxy.ts` redirects a request with *no* session cookie to `/sign-in?next=…` before
     anything renders (optimistic: cookie presence only).
   - `SignedInOnly` (`components/auth/signed-in-only.tsx`) is the authoritative page gate: it asks
     the API whose session the cookie is, redirects an unknown one to sign-in, and renders the
     suspended-account state instead of redirecting (a redirect would loop).
   - The API refuses the data behind the page regardless.
4. **Actions redirect, then the API decides.** "Add to bag" and the wishlist heart send a visitor
   the client session read already knows is signed out straight to sign-in. Anyone else's click is
   sent to the API, and a `401` (expired or revoked session) is turned into the same redirect.
5. **Back to where they were.** Every redirect carries `next` (`signInPath()` in
   `lib/safe-redirect.ts`, validated by `safeRedirectPath`), and both sign-in *and* sign-up now
   honour it — previously sign-up always went to `/account`.
6. **The header reads the cart only when signed in**, so an anonymous page view no longer costs a
   cart request; the cached cart is dropped (not refreshed in place) when the user changes.

## Consequences
- An anonymous visitor cannot build a bag before signing in. That is the requested behaviour; it
  adds a step before the first add, and the product selection (size, colour, quantity) is not
  carried through sign-in.
- Guest checkout would now also need a guest cart again. [ADR 0018](0018-checkout-orders-and-provisional-delivery.md)
  ships checkout as signed-in only for that reason; reopen both ADRs together if it is wanted.
- After the last pre-change guest cart has expired (30 days after deploy), the merge path,
  `guest-token.ts`, the guest branch of `CartOwner` and `carts.guest_token_hash` can be removed
  together, with a migration.
- `/cart` now makes one server-side session read before the bag renders client-side; it streams
  behind the page's static heading and skeleton, so the page still paints at once.

## Alternatives
- **UI-only gating** (keep the API open, hide or redirect in the browser) — rejected: a direct API
  call would still create guest carts, and CLAUDE.md requires authorization on the server.
- **Requiring auth on `POST /cart/items` only** — leaves guests able to read and raise quantities
  on legacy carts, and makes the rule harder to state. One guard on the router is the pattern the
  other account subtrees use.
