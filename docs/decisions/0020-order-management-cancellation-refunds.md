# ADR 0020 — Order Management, Cancellation and Refunds

- **Status:** Accepted for development. The cancellation and refund rules in decisions 2 and 6 are
  **provisional**: PRD §9 has not decided cancellation or refund eligibility, including for COD.
- **Date:** 2026-11-10
- **Related:** [ADR 0003](0003-payment-webhooks-idempotency.md), [ADR 0004](0004-inventory-policy.md),
  [ADR 0018](0018-checkout-orders-and-provisional-delivery.md), [ADR 0019](0019-online-payments-sslcommerz.md)

## Context
M8 lets people change orders after payment: a customer cancelling, an administrator moving an order
through fulfilment, recording cash collected, and refunding. Two earlier milestones left work here.
M7 flags money that needs a person (`PAYMENT_REVIEW_REQUIRED`) and holds risky or underpaid
payments, with nothing yet to act on either. M6 starts COD orders at `COD_PENDING`, with nothing to
record collection. SSLCOMMERZ refunds are two-step (start, then poll for `refunded`), and its
documentation does not say whether a repeated request is ignored.

## Decision
1. **Fulfilment only moves forward, and only by a person** (`order-state.ts`):
   `CONFIRMED → PROCESSING → SHIPPED → DELIVERED`, with cancellation possible up to `PROCESSING`.
   Nobody can move an order to `CONFIRMED` or `PAYMENT_FAILED` by hand: only verified payment news
   does that (ADR 0019). Nothing comes back from `SHIPPED`, because goods that have left are a
   return, which is a refund rather than a status.
2. **A customer may cancel until the order is being prepared** (`PENDING_PAYMENT` or `CONFIRMED`),
   provisionally. After that it takes an administrator. A payment held for review blocks it
   (`409 PAYMENT_PENDING`): a person is already deciding that order. Cancelling is idempotent:
   repeating it answers with the cancelled order.
3. **Every change locks the order row first**, the same lock payment news takes, so a cancellation
   and a payment arriving at the same moment take turns. Each re-reads the status after the lock.
4. **Admin transitions name the status they started from** (`from`). An order that moved since is a
   `409`, not an overwrite. Repeating a transition that already happened is a `200` with no second
   effect.
5. **Cancelling closes everything at once**, in one transaction: status and history, stock released
   by the ledger (ADR 0004, as amended by ADR 0019), an unpaid payment stopped, and a paid one booked
   for a full refund. Before cancelling an unpaid online order, the provider is asked whether it was
   just paid, so a payment made seconds earlier is refunded rather than flagged as late.
6. **Refunds are written down before they are sent** (`refunds.service.ts`).
   - In a transaction, with the order locked, the amount is checked against what is still refundable,
     counting refunds already pending. The `refunds` row is then written as `PENDING`.
   - After commit, the provider is asked, using that row's id as `refund_trans_id`. Its answer is
     recorded with a conditional update, so it applies once.
   - A lost answer leaves the row unacknowledged. The sweep asks again with the same id, never a new
     one. If the provider says a refund was already started but gives no reference, the row waits for
     a person (`REFUND_UNCONFIRMED`) and is never sent again.
   - A refused or abandoned refund becomes `FAILED` and is flagged (`REFUND_FAILED`). Its amount is
     then refundable again.
   - The admin endpoint requires an `Idempotency-Key`, scoped to the order. The same key with the
     same body replays the earlier refund; with a different body it is `409 IDEMPOTENCY_CONFLICT`.
7. **A refund counts as done when the bank says so**, not when it is started. The payment and the
   order become `PARTIALLY_REFUNDED`, then `REFUNDED`, computed from completed refunds.
8. **Cash on delivery is explicit.** Collection is recorded by an administrator once the order has
   shipped (`COD_COLLECTED`), not assumed from "delivered". Collected cash is refunded by hand, so its
   refund is recorded as already done, without the provider.
9. **Held payments are resolved by a person.** A risk hold may be accepted, which completes the order
   as verified payment would. Either hold may be rejected, which cancels the order. A rejected risk
   hold was paid in full, so it is refunded through the provider. An amount-mismatch hold was not, so
   what to return cannot be computed here and it stays flagged (`CANCELLED_WHILE_HELD`).
10. **Audited:** transitions, cash collection, refund requests and hold decisions each write an
    `audit_logs` row in the same transaction (invariant 8). A customer's own cancellation is recorded
    in the order's status history with them as the actor.
11. **Customers see progress, not process.** The order adds a timeline (status and time), tracking
    and refunds. Who made a change, notes, failure codes and provider references stay admin-only.

## Consequences
- A refund the provider's answer was lost for, and that it then calls "already started", needs a
  person to confirm in the SSLCOMMERZ panel. This is the price of never risking a second refund.
- Whether SSLCOMMERZ deduplicates on `refund_trans_id` is assumed, not documented. The local
  stand-in does, and every test depends on that behaviour. Verify it in the sandbox before relying on it.
- The refund API needs the bank's transaction id, which is not stored. It is read from the validation
  API with the stored `val_id` on each refund: one extra request, and no new column.
- In live mode the refund API only accepts calls from a public IP registered with SSLCOMMERZ.
- Nothing runs the sweep on a schedule yet. `npm run payments:reconcile` now also sends unsent
  refunds and records completed ones (M9). *(Resolved in M9: the worker runs the sweep every
  `RECONCILE_INTERVAL_MS`, [ADR 0021](0021-outbox-worker-and-email-delivery.md).)*
- The `ORDER_CANCELLED`, `REFUND_UPDATE`, `SHIPPING_UPDATE` and `PAYMENT_REVIEW_REQUIRED` outbox rows
  are written, but nothing delivers them yet (M9). *(Resolved in M9: the worker has a handler for
  each, [ADR 0021](0021-outbox-worker-and-email-delivery.md).)*
- The admin dashboard's order screens drive all of this. Each change sends the status on screen as
  `from`, and each refund dialog keeps one idempotency key until a refund comes back.
- Returns (a customer asking for money back after delivery) are not built: there is no returns
  policy (PRD §9). An administrator can still refund a delivered order.
- Money that arrives after a customer cancels is flagged for an administrator to refund, rather than
  refunded automatically. That path is rare, and it keeps refunds decisions with a person.

## Alternatives
- **Refund requests from customers, approved by an administrator:** the `refund-request` endpoint in
  the original API sketch. Not built, because what is refundable after delivery is undecided policy.
- **A cancellation that is a request an administrator approves:** safer for the store, slower for
  the customer. Nothing has been picked or packed before `PROCESSING`, so there is nothing to protect.
- **Calling the provider inside the transaction:** a slow provider would hold the order lock, and a
  rollback after a successful call would lose track of money already sent.
- **A new refund id on each retry:** simpler, but a lost response would then risk a second refund.

## Revisit when
PRD §9 decides cancellation and refund eligibility (decisions 2 and 6); returns are wanted; the
sandbox shows how SSLCOMMERZ treats a repeated `refund_trans_id`; or M9 schedules the sweep and
delivers the notifications.
