# CommerceCore — Database Design

**Database:** PostgreSQL · **ORM/migrations:** Prisma · **Status:** Logical baseline; align exact fields/types with `schema.prisma` before implementation.

## 1. Principles
- Normalize mutable domain data and enforce relationships with foreign keys.
- ProductVariant is the purchasable unit when SKU/price/stock differ by option.
- Snapshot product/SKU/price on order items.
- Use DB constraints as well as server validation.
- Record inventory movements and sensitive admin actions.
- Keep transactions short; use concurrency-safe stock writes.
- Archive entities referenced by history rather than cascading deletion of financial records.
- Use integer minor units or exact decimal types for money, never binary floating point.

## 2. Entities
| Entity | Purpose / notes |
|---|---|
| User | Customer/admin identity; normalized unique email, role/status |
| Address | Saved address; owner FK and ownership checks |
| Category | Taxonomy; unique slug; optional parent |
| Product | Catalog content; unique slug, status, category, brand |
| ProductVariant | Purchasable SKU, options, price, stock, threshold, status |
| ProductImage | Object key/URL, alt text, sort order; binary stays in object storage |
| Cart / CartItem | User or guest cart, variant, positive quantity, expiry/merge behavior |
| Coupon | Code, type/value, validity, minimum spend, usage limits, eligible products |
| CouponRedemption | Actor/order/coupon use record to enforce limits and prevent duplicate redemption |
| Order | Unique public order number, status, payment status, currency, totals, contact/shipping snapshots |
| OrderItem | Purchase-time name/SKU/unit price/quantity/discount/tax/line total snapshots |
| Payment | Provider, reference, amount/currency/status, idempotency key |
| WebhookEvent | Unique provider/event ID, event type, processing outcome, safe metadata |
| KnowledgeDocument / KnowledgeChunk | Shopping assistant's policy text and its embedded chunks (`vector(1536)`, HNSW) — ADR 0025 |
| ProductEmbedding | One vector per public product for search by meaning; no price or stock — ADR 0025 |
| AssistantConversation / AssistantMessage | Chats, owned by a customer or a guest token hash; deleted 30 days after the last message — ADR 0025 |
| InventoryMovement | Variant, quantity delta, reason, actor, reference, timestamp |
| InventoryReservation | Optional temporary hold with status/expiry/consume/release timestamps |
| Refund | Amount/status/provider ID/idempotency key/actor/reason |
| OrderStatusHistory | From/to state, actor/system, timestamp, reason |
| OutboxEvent / Notification | Durable job identity, status, attempts, next retry, safe error |
| Review | Optional verified review; uniqueness rules |
| WishlistItem | Saved product per customer; unique (user, product) — ADR 0016 |
| AuditLog | Actor/action/entity and safe before/after metadata |

## 3. ER diagram
```mermaid
erDiagram
  USER ||--o{ ADDRESS : owns
  USER o|--o{ CART : has
  CART ||--o{ CART_ITEM : contains
  PRODUCT ||--o{ PRODUCT_VARIANT : offers
  PRODUCT ||--o{ PRODUCT_IMAGE : displays
  CATEGORY ||--o{ PRODUCT : classifies
  PRODUCT_VARIANT ||--o{ CART_ITEM : selected
  USER o|--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : snapshots
  PRODUCT_VARIANT o|--o{ ORDER_ITEM : referenced_by
  ORDER ||--o{ PAYMENT : has
  PAYMENT ||--o{ REFUND : may_have
  PRODUCT_VARIANT ||--o{ INVENTORY_MOVEMENT : records
  PRODUCT_VARIANT ||--o{ INVENTORY_RESERVATION : held_by
  USER ||--o{ REVIEW : writes
  PRODUCT ||--o{ REVIEW : receives
  USER ||--o{ AUDIT_LOG : performs
```
Guest orders may have no user FK; nullable/optional relations must be represented deliberately in the actual schema. The same applies to carts, which is why `USER o|--o{ CART` is optional on the user side: a guest cart is owned by an opaque token instead (see §10).

This diagram is illustrative and incomplete — COUPON, COUPON_REDEMPTION, ORDER_STATUS_HISTORY, WEBHOOK_EVENT and OUTBOX_EVENT are omitted, and REFUND also references ORDER. The entity table in §2 and `backend/prisma/schema.prisma` are authoritative.

## 4. Important fields and constraints
### User
`id`, normalized unique `email`, `name`, `role`, `status`, timestamps. Never store plaintext passwords; delegate credential handling to the selected auth provider/library.

### Product and ProductVariant
Product: `id`, `name`, unique `slug`, `description`, `brand`, `categoryId`, publication status/timestamps, nullable `featuredRank` (storefront order, > 0; ADR 0013). Variant: `id`, `productId`, unique `sku`, option values, price, currency policy, `stockQuantity`, `lowStockThreshold`, status. Enforce price >= 0, stock >= 0 and threshold >= 0 (SQL CHECK where ORM schema cannot express it).

### Cart
Store user owner or secure opaque guest token, status and expiry. Guest tokens must be high-entropy and treated as secrets. CartItem should have quantity > 0 and usually unique `(cartId, variantId)`; define merge behavior for duplicate/unavailable variants.

### Order / OrderItem
Order stores internal ID, unique public order number, nullable user ID for guest checkout, lifecycle/payment status, currency, subtotal/discount/shipping/tax/total, contact/shipping snapshots, coupon snapshot/reference, idempotency key/request fingerprint and timestamps. OrderItem stores nullable product/variant references plus snapshot name, SKU, unit price, quantity, line discount/tax and line total as needed. Preserve historical values after catalog edits. Avoid cascading deletion of orders when a product is archived/deleted.

### Payment / Refund
Payment: order FK, provider, provider reference, amount/currency/status/idempotency key and safe metadata. Refund: payment/order reference, amount, status, provider refund ID, idempotency key, actor and reason. Never store PAN/CVV.

### WebhookEvent
Store provider, event ID/type, received/processed timestamps, processing status, safe payload metadata/hash, attempt count and last error. Unique `(provider, eventId)`.

### InventoryMovement / Reservation
Every stock change and its reason/actor/reference should be recorded in the same transaction as the balance update. Reservation mode needs quantity, order/checkout reference, status and expiry. Consume/release/expire must be safe when repeated and race safely with payment success.

## 5. Index strategy
Validate with representative data and `EXPLAIN (ANALYZE, BUFFERS)`:
- Unique normalized email, product slug, SKU, public order number, `(provider,eventId)`, normalized coupon code.
- Catalog status/publication date, category and variant/product join keys; price index only if useful for query plan.
- Orders `(userId, createdAt DESC)` and `(status, createdAt DESC)`.
- Foreign keys and common cart owner/status lookups.
- Reservation status/expiry; outbox status/nextAttemptAt; reviews `(productId, createdAt DESC)`.
- Add only indexes that support real query patterns; indexes increase storage and write cost.

## 6. Transaction boundaries
### Decrement-on-order
Within one short transaction: reload trusted catalog/pricing/coupon/shipping; conditionally decrement each variant; create order and item snapshots; create payment/order initial state and inventory movements; insert outbox event. Any required failure rolls back all writes. For multiple variants, use stable ordering and handle deadlocks safely.

### Timed reservation (optional)
Within a short transaction, claim stock and create reservation/order state. Call provider after commit. Verified payment consumes reservation; terminal failure/expiry releases once. Define reconciliation for late payment after expiry before enabling this mode.

### Webhook
Verify signature first; insert event under unique constraint; ignore/reconcile duplicates; apply an allowed conditional state transition; commit; retry recoverable failures idempotently.

## 7. Money and currency
Choose a store currency for v1 unless multi-currency is a real requirement. Store currency on order/payment for historical correctness. Centralize rounding, discounts, shipping and tax in one server pricing service. Verify provider amount/currency against persisted expected values before marking paid.

## 8. Data lifecycle
Define account deletion, order/payment retention, audit retention and notification retention before launch. Anonymize where legally appropriate rather than deleting records needed for financial reconciliation. Minimize address/contact storage and restrict admin access. Keep production data out of fixtures and test logs. Test backup restoration.

## 9. Prisma notes
Encode relations/unique constraints/indexes in `schema.prisma`; add SQL CHECK constraints in migrations if needed. Review generated migrations. Seed/import must be repeatable and must not overwrite live stock/prices on rerun. Use integration tests against PostgreSQL for constraints and concurrency; mocks alone cannot prove race safety.

## 10. Implementation status
This section records how the logical baseline above was realized in `backend/prisma/`. Where the two differ, the schema is authoritative and the reason is given here.

**Implemented (30 models, 20 enums).** Identity (User, Session, Account, Verification), Address, Category, Product, ProductVariant, ProductImage, Cart, CartItem, WishlistItem (ADR 0016: unique `(user_id, product_id)`, index `(user_id, created_at DESC)`, both foreign keys cascade), Coupon, CouponProduct, StoreSettings, Order, OrderItem, OrderStatusHistory, CouponRedemption, Payment, Refund, WebhookEvent, InventoryMovement, OutboxEvent, AuditLog, and the shopping assistant's KnowledgeDocument, KnowledgeChunk, ProductEmbedding, AssistantConversation and AssistantMessage (M13). Checkout, stock claims, order reads, online payment, order management and refunds are built on them (M4, M6, M7, M8).

**Deferred, with reasons.**
- `InventoryReservation` — ADR 0004 chose atomic decrement-on-order, so `ProductVariant.stockQuantity` is what can still be sold. Adding reservations later changes that meaning and needs an available-vs-on-hand split.
- `Review` — PRD §4 marks it optional and its uniqueness rules are undefined. (`WishlistItem` was accepted and added by ADR 0016.)
- `carts.guest_token_hash` is kept only so pre-ADR 0014 guest carts can merge; drop it, with the guest merge code, once the last of them has expired.
- `Notification` — §2 listed it jointly with OutboxEvent; one durable outbox covers the need, so a second table was not created.

**Decisions taken.**
- Money and currency: see [ADR 0008](decisions/0008-money-and-currency.md). Percentages are integer basis points; `currency` lives on Order/Payment/Refund only.
- Coupon usage limits: a `usedCount` counter claimed by a conditional `UPDATE ... WHERE used_count < usage_limit`, mirroring the stock-claim pattern in architecture.md §8, with a CHECK as the backstop. A unique constraint alone cannot enforce a global limit.
- Variant options: `options Json` plus a canonical `optionKey` with a unique `(productId, optionKey)`, so one option combination cannot exist twice on a product.
- Cart ownership: nullable `userId` **or** a `guestTokenHash`, never both and never neither (CHECK), with partial unique indexes giving one ACTIVE cart per owner. Only the token hash is stored.
- Guest order access: `Order.guestAccessTokenHash` was added because §4 listed no such field while API_SPEC.md §6 requires an unguessable token for guest lookup. `orderNumber` must therefore be generated non-sequentially.
- Order idempotency: no request table. `Order.idempotencyKey` holds a per-customer hash of the client's key, beside a fingerprint of the request; a request that failed before commit left no row, so its key can be used again (ADR 0018). `Payment.provider` is `cod` for cash on delivery.
- Online payment (M7, [ADR 0019](decisions/0019-online-payments-sslcommerz.md)): no new table or column. `Payment.id` is the `tran_id` sent to the provider, `providerPaymentRef` its `val_id`, and `safeMetadata` the session reference and gateway URL (never returned by the API). `PROCESSING` means received but held for a person, with the reason in `failureCode`. `WebhookEvent` stores a hash of the payload and the status and `val_id` only, never card or customer fields. `OutboxEventType` gained `PAYMENT_REVIEW_REQUIRED`.
- Order management and refunds (M8, [ADR 0020](decisions/0020-order-management-cancellation-refunds.md)): `Order.shippingCarrier` and `trackingNumber` (nullable, CHECK `orders_tracking_length_check`), and the outbox types `ORDER_CANCELLED` and `REFUND_UPDATE`. A `Refund` row's id is the `refund_trans_id` sent to the provider, and `providerRefundRef` its `refund_ref_id`: `PENDING` with no reference means "not acknowledged", which is what the sweep resends. "No more than was paid" is enforced by the service under the order row lock, not a constraint: a CHECK cannot sum across rows, and pending refunds count towards it.
- Background jobs (M9, [ADR 0021](decisions/0021-outbox-worker-and-email-delivery.md)): `OutboxEvent.claimToken` (nullable; CHECK `outbox_events_claim_token_check`: set exactly when `PROCESSING`), CHECK `outbox_events_last_error_length_check` (≤ 1000), and the outbox type `PAYMENT_RECONCILIATION` (one recurring row, key `recurring:payment-reconciliation`). While `PROCESSING`, `nextAttemptAt` is the lease expiry. `FAILED` means a retry is scheduled, `DEAD` that the worker gave up. Account-email payloads are replaced with `{userId, scrubbed: true}` once `SENT` or `DEAD`. The existing `(status, next_attempt_at)` index serves the claim query.
- Coupons, settings and reporting (M10, [ADR 0022](decisions/0022-coupons-settings-and-admin-reporting.md)): `CouponRedemption.releasedAt` (a closed order's use given back; per-customer limits count rows where it is null; index `(coupon_id, user_id, released_at)`); `StoreSettings`, one row (`store_settings_singleton_check`), with CHECKs on the name, fees, tax rate (0–5000 bps, exclusive) and `version`; indexes `orders(created_at)` for the overview and export and `audit_logs(created_at DESC)` for the audit log. `used_count` is changed only under a `FOR NO KEY UPDATE` lock on the coupon, with `coupons_used_within_limit_check` as the backstop.
- Shopping assistant (M13, [ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md)): migration `assistant`, the first to need an extension (`CREATE EXTENSION vector`, pgvector). The tables are `knowledge_documents`, `knowledge_chunks`, `product_embeddings`, `assistant_conversations` and `assistant_messages`, plus the outbox types `ASSISTANT_INDEX_SWEEP` and `ASSISTANT_RETENTION` (recurring rows `recurring:assistant-index` and `recurring:assistant-retention`).
  - **Vectors:** the columns are `Unsupported("vector(1536)")`, so they are read and written with raw SQL only (`assistant/vector-store.ts`). There are HNSW indexes `knowledge_chunks_embedding_hnsw_idx` and `product_embeddings_embedding_hnsw_idx` (cosine).
  - **No price or stock in the index:** `product_embeddings` holds none, and a search re-reads cards through the publication rule.
  - **CHECKs:**
    - `assistant_conversations_owner_check`: exactly one of `user_id` and `guest_token_hash`.
    - `assistant_messages_content_length_check`: at most 8000 characters, and 1–1000 for a customer's message.
    - `knowledge_documents_path_check`: a store path, never another site.
    - The rest are in the migration.
  - **Deletion:** conversations cascade from the user and are deleted by the retention job. `client_key_hash` is a keyed hash of the sender's IP, used for the guest daily cap.
- Order deletion: `Order.userId` is `onDelete: Restrict`, so account closure must be anonymization, not deletion. `OrderItem` product/variant references are `SetNull` so even a hard delete cannot cascade into order history.
- Redundant fields removed from the baseline: no separate `guestEmail` on Order (`contactEmail` is always required), and no per-line `currency` on OrderItem.

**Constraints that live in migration SQL, not in `schema.prisma`.** 91 CHECK constraints, 3 partial unique indexes and 2 HNSW vector indexes (the assistant migration added 11 CHECKs and both vector indexes). Prisma does not model CHECK constraints and does not know about the partial indexes, so: never run `prisma db push`, and read every future `prisma migrate dev` file before applying it, deleting any `DROP CONSTRAINT`/`DROP INDEX` that targets one. `backend/tests/db/constraints.test.ts` asserts each one still exists, so an accidental drop fails the suite.

**Migration order.** `0001_identity`, `0002_catalog_and_addresses`, `0003_cart_and_coupons`, `0004_orders_payments_inventory`, `0005_outbox_and_audit`, `superadmin_role_and_auth_outbox`, `catalog_import_provenance`, `fix_source_identity_check`, `product_featured_rank`, `wishlist_items`, `product_image_kind`, `payment_review_outbox`, `order_fulfilment_and_refunds`, `cart_item_price_seen` (nullable `cart_items.unit_price_seen_minor`, CHECK >= 0: the unit price last shown for a bag line, display only — checkout never reads it), `outbox_worker` (M9), `admin_completeness` (M10), `catalog_featured_order_index` (M11: replaces `products(featured_rank)` with `products(featured_rank, published_at DESC, created_at DESC, id DESC)`, the `featured` ORDER BY column for column; docs/performance-review.md). Coupons precede orders because `Order.couponId` references them.

**Catalog import provenance (M3, [ADR 0011](decisions/0011-catalog-import-provenance.md)).** `Product.gender` (`MEN | WOMEN | UNISEX`, nullable); `Product.sourceProvider` + `sourceExternalId` (unique together, both-or-neither CHECK `products_source_identity_check`), `sourceUrl`, `sourceContentHash`; `ProductVariant.priceSource` (`MANUAL | SOURCE | SYNTHETIC`, default `MANUAL`); `ProductImage.sourceUrl`, `attribution`. All internal: none are returned by public endpoints. Store currency is BDT (ADR 0008 amendment).

**Featured ordering ([ADR 0013](decisions/0013-featured-dark-edit.md)).** `Product.featuredRank` (nullable, CHECK `products_featured_rank_positive_check`) drives the default `featured` listing order, served by the composite index above so a page is read in order rather than sorted (ADR 0023). Internal: not returned by public endpoints.

**Still open.** Guest checkout policy (PRD §9) — signed-in only for now (ADR 0018), and the schema is guest-capable either way; per-user coupon limits for guests, which have no identity to count against; and data retention and deletion (§8), which decides whether anonymization is enough.
