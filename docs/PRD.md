# CommerceCore — Product Requirements Document

**Status:** Baseline; business and provider decisions listed as open must be resolved before live production.  
**Product:** Single-store e-commerce platform.  
**Users:** Guests, customers, authorized administrators.

## 1. Vision and goals
Provide a complete shopping experience and an administration workspace while demonstrating reliable full-stack engineering: relational data, inventory consistency, ACID transactions, payment webhooks, idempotency, API errors, caching, rate limiting, security, background jobs, and integration testing.

## 2. Scope
### In scope
- Storefront homepage, navigation, categories, product discovery, search suggestions, recently viewed products where practical.
- Product catalog, variants/SKUs, images, specifications, server-side search/filter/sort/pagination, SEO-friendly slugs.
- Persistent customer carts, coupon preview, server-side checkout pricing. Adding to a cart requires an account ([ADR 0014](decisions/0014-account-only-cart-and-protected-routes.md)); guest carts made before that are merged after login.
- Customer wishlist: save products from product cards, a per-customer wishlist page ([ADR 0016](decisions/0016-wishlist.md)).
- Guest and authenticated checkout subject to final policy; shipping/contact details; delivery fee; COD and one online provider in sandbox mode.
- Order history/tracking, cancellation and refund workflow.
- Admin dashboard, product/category/variant/image management, inventory adjustments/history, order/customer management, coupons, settings, analytics, audit logs.
- Email receipts, shipping notifications, low-stock notifications.
- Shopping assistant chat (M13, [ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md)): product discovery, store-policy answers and a signed-in customer's own order status; read-only.
- Tests, migrations, seed/import, deployment docs, observability and operational readiness.

### Out of scope initially
Multi-vendor marketplace, multi-tenant stores, native mobile apps, microservices, complex ERP/warehouse integration, live payments before provider/legal/reconciliation review, and ML recommendation infrastructure.

## 3. Personas and permissions
- **Guest:** browse/search; adding to the bag or wishlist sends them to sign in (ADR 0014); place guest order only if enabled by policy.
- **Customer:** account/profile/address management, persistent cart, wishlist, checkout, own orders, cancellation/refund requests, optional reviews.
- **Admin:** protected catalog/inventory/order/customer/coupon/settings/report operations according to server-enforced role permissions.

Hiding controls in the UI is not authorization. Use least privilege and test direct API calls.

## 4. Functional requirements
### FR-01 Discovery and catalog
Home page with promotions/featured products/categories; responsive navigation; published products only; product detail/gallery/variants/specifications/availability; search by name/description/SKU; filters for category/price/brand/rating/availability where data exists; sorting by price/newest/popularity/rating where meaningful; server-side pagination.

### FR-02 Cart
Add/remove/update quantity; persistent logged-in cart, signed-in only (ADR 0014 — this replaced the earlier "secure guest cart" requirement; guest carts that already existed merge after login with defined conflict behavior); coupon preview; show price/availability changes; revalidate product status, price, variant and stock at checkout.

### FR-03 Checkout and orders
Collect contact/shipping data and delivery option; server computes subtotal, discounts, shipping, tax if configured, and total; accept variant IDs and quantities, never client-authoritative totals; support COD and one sandbox online payment; protect order creation with idempotency and transaction-safe stock handling; confirmation reads persisted order state; queue receipt after commit.

### FR-04 Accounts
Registration/login/logout/password reset, profile and addresses, own order history/detail/tracking, cancellation/refund request/status. Wishlist accepted (ADR 0016): product-level saved items, signed-in only. Verified-purchase reviews are optional until separately accepted.

### FR-05 Administration
Dashboard metrics and recent orders; product/category/variant/SKU/image management; stock adjustment with reason and actor; low-stock alerts; order search and valid fulfillment transitions; customer status/role management with least privilege; coupons with type/value, validity, minimum spend, limits and eligible products; shipping/tax/store settings; audit log; reports/export.

### FR-06 Payments/refunds
One sandbox provider first; official signature verification; unique provider-event deduplication; duplicate/out-of-order event handling; payment attempts and provider references; no raw card data; refund eligibility and duplicate protection; separate COD collection state.

### FR-07 Inventory
Stock per purchasable variant; atomic update or timed reservation; inventory movement history; no negative stock; low-stock notifications; optional reservation expiry/release worker only after late-payment behavior is specified.

### FR-08 Notifications and import
Durable/retryable receipts, shipping and low-stock notifications. Email failure must not invalidate an order. Seed/import sample data into CommerceCore's database; public API is not a runtime dependency and reruns must not overwrite live stock/prices. Use appropriately licensed product images. *(Source chosen 2026-10-27: Kaggle "Fashion Product Images" instead of DummyJSON, which has only 49 fashion items. Its imagery is licensed for development/demo use only. See `docs/fashion-catalog-integration-plan.md` §3.)*

### FR-09 Shopping assistant
A chat assistant in the storefront ([ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md), plan in `docs/assistant-rag-plan.md`). Guests and customers can ask about products in their own words and about store policies; signed-in customers can also ask about their own orders. Prices, stock and order facts come from the database when the answer is given, never from the search index; products shown are published products only. The assistant takes no actions (no cancelling, coupons or cart changes). Answers from draft policy say they are provisional. Conversations are kept 30 days. A provider outage disables the assistant only, never shopping. Usage is limited per customer/guest per day.

## 5. Non-functional requirements
Targets below are planning assumptions, not measured guarantees.

| Area | Baseline |
|---|---|
| Correctness | No negative stock or duplicate logical order/payment/refund effects |
| Security | Server validation, authz/ownership, secure sessions, rate limiting, safe uploads, secret management |
| Performance | Aim for p95 ordinary read API latency <300 ms at a defined test load; measure provider latency separately |
| Search | Aim for p95 catalog search <200 ms at a defined load after representative data is seeded |
| Availability | 99.9% monthly is aspirational and must be supported by hosting, monitoring and budget before commitment |
| Scale | 50,000 concurrent users in the source notes is an example, not a capacity claim; define and load-test a realistic profile |
| Accessibility | Keyboard operation, semantic structure, labels, useful errors, sufficient contrast |
| Privacy | Minimize personal data; define retention/deletion and access policy before launch |
| Recovery | Document backup, restore test, RPO/RTO and incident procedure |

## 6. Business rules
1. Server owns pricing and totals; use integer minor units or exact decimal arithmetic, never binary float for persisted money.
2. Order items snapshot name, SKU, unit price, quantity and necessary purchase details.
3. Inventory belongs to variant when variants are separately purchasable.
4. Cart stock is advisory; checkout revalidates.
5. Payment requires verified provider evidence or explicit COD workflow; redirect alone is insufficient.
6. Network calls occur outside DB transactions.
7. Every state transition is validated.
8. Sensitive admin changes are audited.
9. Historical orders survive catalog archive/edit.

## 7. Acceptance criteria
- Browse a published product, select a valid variant, add to cart and check out.
- Server rejects manipulated price, expired coupon, invalid quantity and unavailable stock.
- Concurrent purchase of final unit never makes stock negative.
- Repeating checkout with same idempotency key does not create a duplicate order; different payload with same key conflicts.
- Duplicate/out-of-order webhook causes no duplicate effects or invalid regression.
- Payment success is recoverable if browser closes.
- Customers cannot access another customer's orders/addresses; non-admin cannot invoke admin APIs.
- Email outage does not invalidate committed order and retries are observable.
- Migrations, seed, tests, setup, API docs and deployment steps are reproducible.

## 8. Release gates
- **MVP:** catalog, auth, cart, checkout/COD + sandbox, orders, admin catalog/inventory/orders, baseline tests/security.
- **Reliability:** webhook idempotency, inventory concurrency, durable notifications, audit, cancellations/refunds.
- **Polish:** reviews, analytics/export, advanced bulk ops, measured cache/search tuning (wishlist delivered early, ADR 0016).
- **Production launch:** provider/live approval, tax/legal/privacy/policy review, backup restore drill, monitoring, security review, load test and runbook.

## 9. Decisions still required
Live payment provider approval (SSLCOMMERZ sandbox chosen for Bangladesh, with bKash on its hosted page, ADR 0019; the 30-minute payment window is a development default); guest checkout policy (signed-in only for now, ADR 0018; would also reopen guest carts, ADR 0014); coupon stacking (one code per order for now, ADR 0022; redemption concurrency is solved there); tax inclusion and rules (an exclusive rate an administrator sets, 0 by default, ADR 0022; inclusive VAT is not supported yet); shipping zones/fees (fees are now administrator settings, ADR 0022, defaulting to ADR 0018's provisional values; the zones are still Dhaka/elsewhere); cancellation/refund eligibility including COD (provisional rules in ADR 0020: customers cancel until an order is being prepared; administrators refund; no returns policy yet); retention/deletion; hosting/storage; email provider (delivery is built over SMTP with a PostgreSQL outbox queue, ADR 0021; the relay is not chosen); load profile, SLO, RPO and RTO; the shopping assistant's provider data processing (chat text and minimal order data go to Groq and OpenAI, ADR 0025; the privacy notice must name them) and its policy sources, which are drafts until the shipping and returns decisions above are made.
