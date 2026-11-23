# ADR 0018 — Checkout, Order Idempotency and Provisional Delivery Rules

- **Status:** Accepted for development. The values in decision 6 are **provisional**: PRD §9 has
  not decided shipping zones, fees or tax, and they must be replaced before launch.
- **Date:** 2026-11-03
- **Related:** [ADR 0003](0003-payment-webhooks-idempotency.md), [ADR 0004](0004-inventory-policy.md),
  [ADR 0008](0008-money-and-currency.md), [ADR 0014](0014-account-only-cart-and-protected-routes.md)

## Context
M6 turns a bag into an order. Several questions had been left for this milestone: whether guests
can check out, what stops a retried request creating a second order (the schema note left "a
separate request table" as an M6 decision), and what delivery costs when PRD §9 has not said. The
flow cannot be built end to end without an answer to each.

## Decision
1. **Signed-in checkout only.** `requireAuth` is on the whole `/checkout` router. ADR 0014 made
   the cart account-only, so a guest has nothing to check out, and guest checkout would reopen that
   ADR. The schema stays guest-capable (`Order.userId` is nullable), so this can change later.
   API_SPEC.md §6 listed these endpoints as "Guest/session"; it is updated to match.
2. **The contact email is the account's.** It is not an input. A receipt must not be a way to send
   mail to a stranger's address. The phone number is an input, and required, because a courier
   needs it and a COD order is settled at the door.
3. **The client names variants and quantities; the server does the rest.** Bodies are strict, so a
   price, total, fee or discount is a `400`. `POST /checkout` also requires `expectedTotalMinor`,
   the total the customer was shown. It is a guard and never what is charged: if the server would
   now charge anything else, it answers `409 CONFLICT` rather than charging more than was agreed.
   The cart is not read to price or validate an order; it is advisory (PRD §6 rule 4).
4. **Idempotency lives on the order; there is no request table.** The order stores a hash of
   `userId:Idempotency-Key` and a fingerprint of the logical request.
   - Same key, same request: the prior order, `200` with `meta.replayed`, no other effect.
   - Same key, different request: `409 IDEMPOTENCY_CONFLICT`.
   - A request that failed before commit left no row, so its key can be used again. Replaying the
     failure instead would be wrong: it failed for reasons that can change (stock came back, a
     connection dropped). This is the reason a request table is not needed.
   - Hashing with the user id scopes keys per customer: the same key from two accounts makes two
     orders, and neither account can reach the other's through it.
   - `expectedTotalMinor` is left out of the fingerprint: it records what was shown, not what is
     being bought, so a retry after a re-quote still finds the order.
5. **The order row is inserted before stock is claimed.** Two concurrent requests with one key then
   collide on the unique index: the second blocks until the first commits, fails having claimed
   nothing, and answers with the first's order. No false `OUT_OF_STOCK`, no double claim. Stock is
   claimed in id order with the conditional write of architecture.md §8 (ADR 0004).
6. **Provisional delivery and totals** (`backend/src/modules/pricing/pricing.ts`):
   - Bangladesh only. Any other country is a `400`.
   - The zone is derived from the address (`city` equal to "Dhaka", ignoring case and surrounding
     space, otherwise national), so a customer cannot select a cheaper zone.

     | Option | Dhaka | Elsewhere | Estimate shown |
     |---|---|---|---|
     | `standard` | ৳80 | ৳150 | Usually 3–5 working days |
     | `express` | ৳150 | ৳250 | Usually 1–2 working days |

   - Tax is 0. No discount exists: coupons are not built (M5/M10), and `couponCode` is a `400`.
7. **COD starts confirmed.** `status CONFIRMED`, `paymentStatus COD_PENDING`, a `Payment` row with
   provider `cod` and status `PENDING`. There is no payment to wait for, and collection is its own
   state (API_SPEC.md §9). `ONLINE` was a `400` until M7, which starts such orders at
   `PENDING_PAYMENT` ([ADR 0019](0019-online-payments-sslcommerz.md)).
8. **One transaction, then done.** Order, items, status history, payment, stock claims, movements,
   low-stock alerts, the `ORDER_RECEIPT` outbox event, the removal of bought lines from the bag and
   the optional saved address commit together. No network call happens inside it. The outbox
   payload holds identifiers only; the M9 worker reads the order when it sends.
9. **A low-stock alert fires on crossing the threshold**, not on every sale below it, and commits
   with the order. (`adminAdjustStock` still inserts its alert after its transaction, without this
   crossing check. That inconsistency is pre-existing and left for M9, when the alerts are consumed.)

## Consequences
- A lost response is safe: the browser keeps the key in `sessionStorage` until an order comes back,
  so a retry or a reload after a dropped connection finds the first order.
- A key reused after the customer edited the form, following a lost response, is refused with
  `IDEMPOTENCY_CONFLICT`. The page then sends them to check their orders before retrying.
- Replays and conflicts can only be recognised while the order row exists. Orders are not deleted
  (`Order.userId` is `Restrict`, PRD §6 rule 9), so that holds.
- A city written differently ("Dhaka North") is charged the national rate. The customer sees the fee
  before agreeing; it is a known roughness of a provisional rule.
- `Order.status` history starts here; transitions out of `CONFIRMED`, and releasing stock on
  cancellation, are M8.
- Nothing delivers the receipt yet: the event waits in `outbox_events` until M9. The confirmation
  page therefore does not claim an email was sent.

## Alternatives
- **A separate idempotency-request table** storing every response: replays failures too, which is
  the wrong behaviour here, and adds a table for no case an order row does not already cover.
- **Reading the items from the cart** instead of the body: simpler for the client, but API_SPEC.md
  §6 and architecture.md §7 specify variant ids and quantities, and a request whose meaning depends
  on server state cannot be fingerprinted as "the same request".
- **A signed quote token** in place of `expectedTotalMinor`: stronger only against a tampered client,
  which the check does not need to resist, because the server charges its own computed total anyway.

## Revisit when
PRD §9 decides shipping zones, fees and tax (replace decision 6, ideally with M10's store settings);
guest checkout is wanted (reopens decision 1 and ADR 0014); M7 adds online payment (decision 7); or
coupons arrive (add `couponCode` and redemption to the transaction).
