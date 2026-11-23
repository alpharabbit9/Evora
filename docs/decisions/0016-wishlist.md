# ADR 0016 — Customer Wishlist

- **Status:** Accepted
- **Date:** 2026-11-01
- **Related:** [ADR 0012](0012-public-catalog-api-and-cart-ownership.md), [ADR 0014](0014-account-only-cart-and-protected-routes.md);
  PRD FR-04 ("Wishlist … optional until separately accepted") — accepted by the product owner on
  this date

## Context
The product owner asked for a wishlist button on product cards and a wishlist page for each
customer. The PRD had left the feature optional with its uniqueness rules undefined, so
`WishlistItem` was deliberately absent from the schema.

## Decision
1. **Product-level, one row per customer and product.** `wishlist_items (user_id, product_id,
   created_at)` with a unique `(user_id, product_id)` index. A card has no size or colour to pick;
   that choice stays on the product page. Both foreign keys cascade.
2. **Nothing but the id is stored.** The list is re-read from the catalog on every request (the
   same card query as `/products`), so it always shows today's price and availability, and no
   price is ever stored or accepted.
3. **Publication rule on both sides.** Only a product the public catalog shows can be saved; an
   unknown id and an unpublished one both answer the same `404`. A saved product that is later
   taken down drops out of the list with nothing about it revealed, and its row is kept so it
   returns if the product does.
4. **API under the account subtree, signed-in only** (`/api/v1/me/wishlist`, its own
   `requireAuth`): `GET /` returns the whole list newest first; `PUT /items/:productId` saves and
   `DELETE /items/:productId` removes. Both are idempotent: a repeat, a retry or a double click
   leaves the same state, and `INSERT … ON CONFLICT DO NOTHING` makes concurrent saves of the same
   product leave one row. Every response is the whole list, like the cart.
5. **A cap of 100 saved pieces** (`MAX_WISHLIST_ITEMS`), checked before each new save (`409
   CONFLICT` beyond it; re-saving an already saved piece still succeeds). It bounds the list read
   and is why the list is not paginated. It is a soft bound: two concurrent saves at the limit can
   both pass, acceptable for a resource limit that protects neither money nor stock.
6. **Storefront.** A heart on every product card (a sibling of the card's link — a button cannot
   sit inside a link), an optimistic toggle with `aria-pressed`, a count in the header, and
   `/wishlist` showing the saved cards. Signed-out clicks go to sign-in and come back (ADR 0014).
   Toggles share one mutation scope, so they reach the server in click order and only the last of
   a burst writes the server's list back, which keeps a fast series of clicks from flickering.

## Consequences
- The product page does not have a heart yet; adding one reuses `WishlistButton` unchanged.
- No "price dropped" or "back in stock" notice: nothing records an earlier price or state, and
  notifications need the M9 outbox worker.
- Removing a product row (rather than archiving it) also removes it from every wishlist.

## Alternatives
- **Variant-level items** — would force a size/colour choice on a listing card, or store a
  half-chosen variant.
- **Storing the list in the browser** — not available across devices, and could not be trusted for
  anything the server later does with it (notifications, analytics).
- **`POST /me/wishlist` with a body** — not idempotent by method, and needs a separate "already
  saved" answer; `PUT` on the product's own path states the end state.
