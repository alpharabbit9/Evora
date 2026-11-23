# ADR 0019 — Online Payments Through the SSLCOMMERZ Sandbox

- **Status:** Accepted for sandbox. Live payments stay out of scope (PRD §2, §8); the live host is refused at boot.
- **Date:** 2026-11-09
- **Related:** [ADR 0003](0003-payment-webhooks-idempotency.md), [ADR 0004](0004-inventory-policy.md),
  [ADR 0008](0008-money-and-currency.md), [ADR 0018](0018-checkout-orders-and-provisional-delivery.md)

## Context
M7 adds the one online provider of PRD FR-06, which PRD §9 had left open. The store is Bangladesh-only
and prices in BDT (ADR 0008, ADR 0018), so the provider must take BDT from Bangladeshi customers,
including bKash. Payment can finish after the browser closes, messages can repeat or arrive out of
order, and the provider can be unreachable.

## Decision
1. **SSLCOMMERZ, sandbox only.** BDT-native, with cards and mobile banking on one hosted page, and a
   free self-service sandbox. Customers enter payment details on its page, so no card data reaches us.
   `SSLCOMMERZ_BASE_URL` refuses the live host. With no credentials the store offers cash on delivery
   alone, so nothing leads nowhere.
2. **bKash is a channel on that page, not a second integration.** The product owner chose the route
   testable without a bKash merchant account. The documentation lists `bkash` among the hosted page's
   mobile banking gateways, so no provider code differs. Its `multi_card_name` parameter could preselect
   bKash, but the same documentation says "Do not Use!", so it is not sent and the customer chooses there.
3. **A provider message is a doorbell, not a fact.** Webhook, browser return and reconciliation all do
   the same thing: ask the provider's status API, outside any transaction, then apply the answer in one
   short transaction through one pure function (`decide` in `payment-state.ts`). So a duplicate, a late
   arrival or a forgery can only make us ask again. A signed failure stands when the status API has
   nothing decisive, because a cancelled attempt may never appear there. A signed success with no
   confirmation is not enough: `503`, and it is retried.
4. **Money that moved is a fact.** A success may overturn a recorded failure; a failure may never
   overturn a recorded success. So order of arrival cannot change the result.
5. **Placing an order makes no network call.** `POST /checkout` commits as it does for COD, except
   that the order starts at `PENDING_PAYMENT`, and the receipt and bag removal wait for payment.
   `POST /orders/:orderId/payment-session` then fetches the gateway URL as a separate step, so first
   attempt, retry after an outage and coming back later are one code path, and an outage leaves a
   recoverable order. A session already issued is reused.
6. **Serialised per order, deduplicated per event.** `(provider, event_id)` being unique recognises a
   finished event. An event received but never finished is allowed through again. Each change takes
   `SELECT … FOR UPDATE` on the order row first, and an event is marked processed in the same
   transaction as its effect.
7. **The signature is necessary, not sufficient.** `verify_sign` is checked as the official library
   does, in constant time. Because `verify_key` comes from the message and names which fields are
   signed, `status`, `tran_id` and `val_id` must be among them. MD5 is the provider's choice.
8. **Stock follows ADR 0004.** Claimed at order creation, released by a compensating movement when
   payment fails. `releaseStock` now works from the ledger balance for the order and variant rather
   than from "was a release ever written", because a late re-claim followed by M8's cancellation would
   otherwise leak the unit.
9. **Money after close.** A success on a closed order records the payment and re-claims stock if it can.
   If the goods have sold, the order stays closed, `paymentStatus` becomes `PAID`, and a
   `PAYMENT_REVIEW_REQUIRED` outbox event asks a person to refund (M8). Stock never goes negative.
10. **Untrusted successes are held.** An amount or currency other than what was charged, or a non-zero
    `risk_level`, moves the payment to `PROCESSING` with the reason in `failureCode` and releases no
    goods. The amount compared is `currency_amount`/`currency_type`, what we sent, since `amount` can be
    a conversion. An unreadable amount or risk level counts as untrustworthy. The documentation says of
    risky transactions to "hold the service".
11. **The window to pay is 30 minutes** (`PAYMENT_WINDOW_MS`), a development default for how long
    abandoned orders hold stock. Reconciliation closes them after it, and never when the provider's
    answer is unknown, since that could release goods somebody paid for.
12. **One attempt per order.** A failed payment closes the order; the customer's bag is intact, and they
    place a new order. Retrying on the same order would have to re-claim stock that may have gone.

## State transitions

| Now | News | Result |
|---|---|---|
| `PENDING`/`PROCESSING`, order waiting | verified success | `SUCCEEDED`; order `CONFIRMED`/`PAID`; receipt; bag emptied |
| `PENDING`/`PROCESSING`, order waiting | failure | `FAILED`/`CANCELLED`; order `PAYMENT_FAILED`; stock released |
| `PENDING`/`PROCESSING` | success, wrong amount or risky | `PROCESSING` hold; review event |
| `FAILED`/`CANCELLED`, order `PAYMENT_FAILED` | verified success | `SUCCEEDED`; re-claim, then confirm or review |
| `FAILED`/`CANCELLED`, order `CANCELLED` | verified success | `SUCCEEDED`; order stays closed; review event |
| `SUCCEEDED` or later | failure, or the same success | nothing |
| `SUCCEEDED` or later | success with another `val_id` | nothing changes; review event |
| anything | still pending | nothing |

## Consequences
- **Not verified against the real gateway.** Every test uses a local stand-in built from the
  documentation (`scripts/payments/fake-sslcommerz.ts`). No sandbox store existed when this was written.
- **The signature algorithm is unconfirmed.** It comes from the official PHP library, but it did not
  reproduce the `verify_sign` in the documentation's sample IPN using the documented sample password.
  The sample may be illustrative. A wrong algorithm fails closed: notifications answer `401`, and
  payments still settle through the browser return and reconciliation. So check this first with a
  sandbox store: a `401` in the logs for a real notification means this is wrong.
- **Undocumented, and handled defensively:** the method of the browser return (both `GET` and `POST`
  are served), IPN retry behaviour (reconciliation is the backstop), and session lifetime.
- **Nothing schedules reconciliation yet.** Abandoned orders hold stock, and payments no notification
  reached stay unsettled, until `npm run payments:reconcile` runs. A host cron job must run it until the
  M9 worker takes it over. *(Resolved in M9: the worker runs the sweep every `RECONCILE_INTERVAL_MS`,
  [ADR 0021](0021-outbox-worker-and-email-delivery.md).)*
- **Nothing consumes review events yet.** `PAYMENT_REVIEW_REQUIRED` rows wait in `outbox_events`, and
  held payments are visible only through `GET /payments/:id` for an administrator. Resolving a hold and
  refunding are M8. *(Resolved in M8/M9: administrators accept or reject holds and refund,
  [ADR 0020](0020-order-management-cancellation-refunds.md); the worker delivers review events,
  [ADR 0021](0021-outbox-worker-and-email-delivery.md).)*
- Notifications cannot reach `localhost`, and the provider requires a public listener on port 80 or 443.
  In production its source addresses should be allowed through any firewall (see its documentation).
- A customer with a waiting order still has those items in their bag, so they could order them again.
- A late re-claim raises no low-stock alert; that path is rare and alerts are unconsumed until M9.
- The store does not record which channel paid (bKash or card). The exact `card_type` text for bKash is
  undocumented, and nothing here needs it yet.

## Alternatives
- **Direct bKash Tokenized Checkout:** a separate checkout option and possibly a direct merchant
  relationship, but bKash must issue the credentials, so it could not be tested without a merchant
  account. Its callback signature has no documented verification procedure. It fits the
  `PaymentProvider` interface with one addition, since bKash needs a server-side execute step.
- **Stripe:** the cleanest webhook model, but not an option for a merchant based in Bangladesh.
- **The provider's npm package:** gives no control over timeouts or error shape. A status query's URL
  carries the store password, so failures must not quote it.
- **Trusting signed notifications without asking the provider:** simpler, but makes arrival order
  matter and leaves the documented validation step undone.
- **Reserving stock instead of decrementing:** rejected by ADR 0004.
- **Emptying the bag at order creation:** a declined card would cost the customer their bag.

## Revisit when
A sandbox store exists (verify the signature, the return method and bKash on the page); M8 builds holds,
refunds and cancellation; M9 schedules reconciliation; or going live, which needs the launch gates of
PRD §8 and a decision on the payment window.
