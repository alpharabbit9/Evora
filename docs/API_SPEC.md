# CommerceCore — API Specification

**Base path:** `/api/v1` · **Style:** JSON REST, except provider webhooks/upload flows. **Status:** Proposed contract; synchronize with implemented handlers.

## 1. Conventions
- JSON mutations use `Content-Type: application/json`; validate body, path and query server-side.
- Timestamps use ISO 8601 UTC; use opaque IDs.
- Pagination: choose one consistent convention (suggested `page` 1-based and `pageSize`, capped server-side); use cursor pagination for high-churn datasets if justified.
- Allow-list sort/filter values; never interpolate user-provided SQL/order expressions.
- Auth defaults to secure server-managed session/cookie; exact auth library is a repository decision.

### Success envelope
```json
{"data":{"id":"opaque-id"},"meta":{"requestId":"request-id"}}
```
Collection:
```json
{"data":[],"meta":{"page":1,"pageSize":20,"total":0,"requestId":"request-id"}}
```
Error:
```json
{"error":{"code":"VALIDATION_ERROR","message":"The request could not be processed.","details":[{"field":"quantity","issue":"Must be greater than zero"}],"requestId":"request-id"}}
```
Do not expose stack traces, SQL, secrets, provider internals or private fields.

## 2. Status codes
`200` read/update/action; `201` created; `202` durable async operation accepted; `204` no body; `400` malformed request; `401` no valid session; `403` not permitted; `404` missing/hidden resource; `409` conflict/idempotency/state/stock; `422` semantic validation if adopted consistently; `429` rate limited; `500` safe generic unexpected error; `502/503/504` only for relevant upstream failure/timeout.

## 3. Auth/account
**Implemented (M2).** The `/auth` subtree is served by Better Auth 1.7, so the paths are its
own — note `/sign-up/email`, `/sign-in/email` and `/request-password-reset` rather than the
`/register`, `/login` and `/forgot-password` this table proposed. See
[ADR 0009](decisions/0009-identity-authorization-and-rate-limiting.md).

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/auth/sign-up/email` | Public + rate limit | Register; signs in on success |
| POST | `/auth/sign-in/email` | Public + rate limit | Start session |
| POST | `/auth/sign-out` | Session | End session (deletes the row, not just the cookie) |
| GET | `/auth/get-session` | Session | Current session |
| POST | `/auth/change-password` | Session + rate limit | Change password; may revoke other sessions |
| POST | `/auth/request-password-reset` | Public + rate limit | Start reset; same answer for known and unknown email |
| POST | `/auth/reset-password` | Reset token + rate limit | Set new password; revokes all sessions |
| POST | `/auth/send-verification-email` | Session + rate limit | Queue a verification link |
| GET | `/auth/verify-email` | Verification token | Mark the address verified |
| GET/PATCH | `/me` | Session | Read/update own profile (`name`, `image` only) |
| GET | `/me/sessions` | Session | Own active sessions, **without** tokens |
| DELETE | `/me/sessions/:sessionId` | Owner | Revoke one of own sessions |
| GET/POST | `/me/addresses` | Session | List/create own address |
| PATCH/DELETE | `/me/addresses/:addressId` | Owner | Update/delete own address |
| GET | `/me/wishlist` | Session | Own saved products, newest first, as catalog cards |
| PUT | `/me/wishlist/items/:productId` | Session | Save a product (idempotent); answers with the whole list |
| DELETE | `/me/wishlist/items/:productId` | Session | Remove a product (idempotent); answers with the whole list |

**Wishlist** ([ADR 0016](decisions/0016-wishlist.md)), `backend/src/modules/wishlist/`. No body on
either write. Only a product that passes the catalog publication rule can be saved; an unknown or
unpublished id is `404 NOT_FOUND`. A product taken down after it was saved is left out of the list.
At most 100 saved products per account: a new save beyond that is `409 CONFLICT`. Response:
`{"data":{"items":[{"savedAt":"…","product":{…card, as in GET /products…}}],"count":1}}`.

`GET /auth/list-sessions` is deliberately **not served** (404): Better Auth returns whole
session rows there, including the session `token`. `GET /me/sessions` is the projection
without it.

`PATCH /me` and the address bodies are strict: an unknown key — `role`, `status`, `email`,
`userId` — is a `400 VALIDATION_ERROR`, not a silently dropped field.

Password reset and email verification are functional **up to delivery only**. The link is
written to `outbox_events`; no email provider is selected (PRD §9) and the sending worker is
M9, so nothing is sent yet and `requireEmailVerification` is `false`.

Use maintained auth flows, secure cookies and appropriate CSRF protections; never implement password cryptography manually.

## 4. Catalog
**Implemented (M3 / fashion catalog Phase 3)** in `backend/src/modules/catalog/`. See
[ADR 0012](decisions/0012-public-catalog-api-and-cart-ownership.md).

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/products` | Public | Search/list/filter/sort/page published products |
| GET | `/products/facets` | Public | Filter options and counts for a scope (`q`, `category`, `gender`) |
| GET | `/products/:slug` | Public | Product detail with purchasable variants |
| GET | `/categories` | Public | Active categories with public products, as a two-level tree with counts |
| GET | `/categories/:slug/products` | — | **Not built**: `/products?category=` covers it |
| GET | `/search/suggestions?q=` | Public + own rate limit (120/min) | Search-as-you-type: up to 5 products and 3 categories |

`GET /search/suggestions?q=` (`q` 2–100 chars, no other key). `products` are the first five that
`GET /products?q=` would list, in the same relevance order (`slug`, `name`, `brand`, `currency`,
`priceMinor`, `maxPriceMinor`, `image`); `categories` are public categories whose name contains
every word (`slug`, `name`, `parentName`); `totalProducts` is the full search's count. Being a GET,
it is outside the `write` limiter, so it has its own.

`GET /products` query keys (unknown keys are a `400`):

| Key | Meaning |
|---|---|
| `q` | 1–100 chars. Every word must match name, brand, description, category or variant colour. |
| `category` | Category slug; a parent includes its children. |
| `gender` | `men` (MEN + UNISEX), `women` (WOMEN + UNISEX), `unisex`. |
| `brand`, `color`, `size` | Comma-separated lists (≤10/12/20 values). Sizes match case-insensitively. |
| `minPrice`, `maxPrice` | Integer **minor units** (poisha), inclusive. `minPrice > maxPrice` is a `400`. |
| `inStock` | `true` / `false`. |
| `sort` | `relevance` (default with `q`; ties broken by `featured`), `featured` (default otherwise: featured products by rank, then newest — ADR 0013), `newest`, `price_asc`, `price_desc`, `name_asc`. `popularity` and `rating` are not offered — no data behind them. |
| `page`, `pageSize` | 1-based; `pageSize` default 24, max 100. |

`color`, `size`, price and `inStock` apply to **one variant at a time**. Only products that pass the
publication rule appear; a hidden or missing slug answers `404 NOT_FOUND`. Responses never contain
stock counts, `priceSource` or provenance fields; availability is `in_stock | low_stock |
out_of_stock`.

Example (`GET /api/v1/products?gender=men&category=boots&pageSize=1`):
```json
{"data":[{"id":"cm…","slug":"clarks-men-black-leather-boots-12345","name":"Clarks Men Black Leather Boots",
  "brand":"Clarks","gender":"men","category":{"slug":"boots","name":"Boots"},"currency":"BDT",
  "priceMinor":500000,"maxPriceMinor":500000,"compareAtPriceMinor":null,"colors":["Black"],"inStock":true,
  "image":{"url":"http://localhost:4000/media/catalog/fashion-product-images/12345/1.jpg","alt":"…","width":1080,"height":1440}}],
 "meta":{"page":1,"pageSize":1,"total":14,"requestId":"…"}}
```
`GET /products/:slug` adds `description`, `category.parent`, `images[]`, `sizes[]` and
`variants[]` (`id`, `sku`, `color`, `size`, `priceMinor`, `compareAtPriceMinor`, `availability`).

## 5. Cart
**Core implemented** in `backend/src/modules/cart/` ([ADR 0012](decisions/0012-public-catalog-api-and-cart-ownership.md)).
**Signed-in only** since [ADR 0014](decisions/0014-account-only-cart-and-protected-routes.md): every
cart endpoint answers `401 UNAUTHENTICATED` without a session, and guest carts are no longer created.
A coupon is entered at checkout, not on the cart (§6, [ADR 0022](decisions/0022-coupons-settings-and-admin-reporting.md)).

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/cart` | Session | Read own cart, re-priced (never creates one) |
| POST | `/cart/items` | Session | Add `{variantId, quantity}`; creates the account cart if needed |
| PATCH | `/cart/items/:itemId` | Session, own line | Set `{quantity}` |
| DELETE | `/cart/items/:itemId` | Session, own line | Remove item |
| POST | `/cart/merge` | — | **Replaced**: a signed-in request still carrying a pre-ADR 0014 guest cookie merges on any cart call |
| POST/DELETE | `/cart/coupon` | — | **Not built by design**: the code goes with the quote and the order (§6) |

Bodies are strict: a `priceMinor`, total or stock field is a `400`. Quantity is 1–10 per line, at most
50 lines. Add/raise checks the variant passes the publication rule (`404`), has stock (`409
OUT_OF_STOCK`), and the resulting line fits stock and the cap; a failure rolls the change back.
Every response is the whole cart: `items[]` with `status` (`available | insufficient_stock |
out_of_stock | unavailable`), current `unitPriceMinor`/`lineTotalMinor`, `previousUnitPriceMinor`
(the unit price last shown when the line was added or its quantity changed, if the catalog price
has moved since; otherwise `null`), `itemCount`, `subtotalMinor` (available lines only) and
`hasIssues`. Another owner's line is a `404`.
Guest carts made before ADR 0014 used a 256-bit token in the httpOnly `commercecore.cart` cookie
(path `/api/v1/cart`), stored only as a SHA-256 hash; no new tokens are issued, and a live one is
merged into the account and cleared on the next signed-in cart request. Cart totals are estimates
until checkout; stock is not reserved.

## 6. Checkout and orders
**Implemented (M6)** in `backend/src/modules/checkout/` and `modules/pricing/`
([ADR 0018](decisions/0018-checkout-orders-and-provisional-delivery.md)). Signed-in only: guest
checkout is not offered, because the cart is account-only (ADR 0014). Cash on delivery, and online
payment since M7 (§7).

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/checkout/quote` | Session | Recalculate current pricing, delivery and availability; writes nothing |
| POST | `/checkout` | Session + `Idempotency-Key` | Create the order |
| GET | `/orders` | Session | List own orders |
| GET | `/orders/:orderId` | Owner | Order detail, read from the order's snapshots; another owner's is a `404` |
| GET | `/admin/orders/:orderId` | Admin | Any order's detail (§8) |
| POST | `/orders/:orderId/cancel` | Owner | Cancel it (M8); replaces the sketched `cancel-request`, because it acts at once |
| POST | `/orders/:orderId/refund-request` | — | **Not built**: no returns policy (PRD §9); an administrator refunds (§8) |
| GET | `/orders/:orderId/tracking` | — | **Not built as a separate endpoint**: the order detail carries `timeline` and `tracking` |

**Cancelling (M8, [ADR 0020](decisions/0020-order-management-cancellation-refunds.md)).** Optional
body `{reason}` (1–500 characters); strict. Allowed while the order is `PENDING_PAYMENT` or
`CONFIRMED` (provisional policy). It releases the stock, stops an unpaid payment, and refunds a paid
online one in full. Repeating it answers `200` with the cancelled order.

| Outcome | Status |
|---|---|
| Cancelled, or already cancelled | `200`, the order |
| Already being prepared or closed without payment | `409 CONFLICT` |
| The payment is held for review | `409 PAYMENT_PENDING` |
| Another customer's order | `404` |

`POST /checkout/quote` body: `{items:[{variantId,quantity}], destination?:{city,countryCode}, deliveryOption?, couponCode?}`.
It answers with `items[]` (each with the cart's `status` values, current prices, product name and
photo), `deliveryOptions[]` (only those the store offers), `subtotalMinor`, `discountMinor`, `taxMinor`,
`shippingMinor`, `totalMinor` (both `null` until a `destination` is given), `paymentMethods`,
`hasIssues`, `freeShippingThresholdMinor` and `coupon` (`{code, status: applied|refused,
discountMinor, message}`, or `null`). An unavailable line and a refused code are statuses, not errors;
a variant that does not exist is a `404`. Fees, tax and free delivery come from the store settings
(M10, [ADR 0022](decisions/0022-coupons-settings-and-admin-reporting.md)).

`POST /checkout` headers: `Idempotency-Key` (16–128 URL-safe characters, required). Body:
```json
{"items":[{"variantId":"cm…","quantity":1}],
 "shipping":{"recipientName":"…","phone":"+880…","line1":"…","line2":null,"city":"Dhaka","state":null,"postalCode":"1207","countryCode":"BD"},
 "deliveryOption":"standard","paymentMethod":"COD","saveAddress":false,"expectedTotalMinor":258000}
```
Bodies are strict: a price, total, fee, discount or email is a `400`. Up to 50 lines, quantity 1–10,
each variant once. `saveAddress` also stores the address on the account, never as the default.
`couponCode` (optional, one per order) is checked again inside the order's transaction: a code that
no longer applies, or whose limits were reached meanwhile, is `409 COUPON_INVALID` with the reason, and
nothing is committed. A delivery option the store has switched off is a `400`. The code is part of the
idempotency fingerprint.

| Outcome | Status |
|---|---|
| New COD order (`CONFIRMED`, `COD_PENDING`) | `201` |
| New online order (`PENDING_PAYMENT`, `PENDING`); no receipt, and the bag is kept, until payment is verified | `201` |
| `ONLINE` with no provider configured, or a total outside its limits (৳10 to ৳500,000) | `400 VALIDATION_ERROR` |
| Same key, same request (an item order change is the same request) | `200`, the prior order, `meta.replayed: true`, no other effect |
| Same key, different request | `409 IDEMPOTENCY_CONFLICT` |
| `expectedTotalMinor` differs from the server's total, or a product was taken down | `409 CONFLICT` |
| Not enough stock for a line; the whole order rolls back | `409 OUT_OF_STOCK` |
| Invalid body, missing key, or a country the store does not deliver to | `400 VALIDATION_ERROR` |
| Over the checkout allowance (30 a minute, on top of the general write limit) | `429 RATE_LIMITED` |

Keys are scoped per customer. A request that failed before commit left nothing behind, so its key can
be used again. Responses never include stock counts, the idempotency key or the fingerprint. Order
detail adds `contact`, `shipping` and `items[]` with snapshots; `items[].image` is the one field read
through to the catalog, and it is `null` once the product is gone. It also adds `payment`:
`{id, status, canResume}` for an online order, `null` for COD; `timeline` (`[{status, at}]`, oldest
first); `tracking` (`{carrier, number}` once shipped, else `null`); `refunds`
(`[{id, amountMinor, status, createdAt}]`); and `canCancel`. The quote's `paymentMethods` lists what
may be chosen for its total.

## 7. Payments and webhook
**Implemented (M7)** in `backend/src/modules/payments/`
([ADR 0019](decisions/0019-online-payments-sslcommerz.md)). SSLCOMMERZ sandbox; bKash, cards and mobile
banking are channels on its hosted page. Not yet verified against the real sandbox.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/orders/:orderId/payment-session` | Owner | Where to pay: `{redirectUrl}`. Reuses a session already issued |
| GET | `/payments/:paymentId` | Order owner/admin | Read safe status |
| POST | `/webhooks/payments/:provider` | Provider signature | Provider event (form-encoded); no session, Origin check or rate limit |
| GET/POST | `/payments/return/:paymentId` | Public, rate limited | The customer's browser back from the gateway. Always a `303` to the storefront |

Placing an order makes no call to the provider, so the session is a separate step.

`POST /orders/:orderId/payment-session` outcomes:

| Outcome | Status |
|---|---|
| Session started or reused | `200` |
| Not the owner, or no such order | `404` |
| A COD order, one no longer waiting, or the 30-minute window has passed | `409 CONFLICT` |
| Payment received and held for review | `409 PAYMENT_PENDING` |
| The provider gave no answer; the order is unaffected, retry | `503 PROVIDER_UNAVAILABLE` |

`POST /webhooks/payments/:provider` outcomes:

| Outcome | Status |
|---|---|
| Processed: `{received:true, duplicate:false}` | `200` |
| Already processed, no further effect: `{received:true, duplicate:true}` | `200` |
| Signed, but about no payment of ours; recorded, a retry could not help | `200` |
| Signature invalid, or a field we act on is not covered by it; nothing stored | `401 UNAUTHENTICATED` |
| Unknown provider | `404` |
| Provider unreachable, or a signed success it has not confirmed; retry | `503 PROVIDER_UNAVAILABLE` |

A notification is not believed on its own: the status API is asked, and that answer is applied. Since M8 the sweep also sends unsent refunds and
records completed ones (§8). The
browser return is believed about nothing, so forging one achieves nothing. A client can never set a
payment status. `GET /payments/:paymentId` returns `id`, `orderId`, `provider`, `method`, `status`,
`amountMinor`, `currency` and `createdAt`, plus `failureCode` for an administrator only, because it can
name a fraud hold. Provider references, session URLs and notification payloads are never returned.

`npm run payments:reconcile` settles what no notification did and closes abandoned orders. Nothing
schedules it yet.

## 8. Admin API
All routes require server-side admin authorization.

**Implemented (M2):** `GET /admin/customers`,
`PATCH /admin/customers/:userId/status` (ADMIN; suspending also revokes that user's
sessions), `PATCH /admin/customers/:userId/role` (**SUPERADMIN only** — see ADR 0009) and
`GET /admin/orders/:orderId`. Both customer writes record an `audit_logs` row in the same
transaction as the change.

**Implemented (M3 — admin catalog CRUD):** all product, variant, image, and category
endpoints below. Every write records an `audit_logs` row in the same transaction. Bodies
use `strictObject` (unknown fields → 400). Variant/image routes are scoped to their parent
product (404 if the child does not belong to the product in the URL).

| Method | Endpoint | Status | Purpose |
|---|---|---|---|
| GET | `/admin/overview?from=&to=` | **Implemented (M10)** | Sales, refunds, net, average order, orders by status, sales per store day, best sellers, low-stock count, latest orders; `YYYY-MM-DD`, default last 30 days, at most 366 |
| GET | `/admin/products` | **Implemented** | List/search products (query: `q`, `status`, `categoryId`, `gender`, `page`, `pageSize`) |
| POST | `/admin/products` | **Implemented** | Create product (201); auto-generates slug if omitted |
| GET | `/admin/products/:productId` | **Implemented** | Full product detail incl. variants, images, provenance |
| PATCH | `/admin/products/:productId` | **Implemented** | Update product (PATCH semantics; sets `publishedAt` on first publish) |
| POST | `/admin/products/:productId/archive` | **Implemented** | Archive product (idempotent) |
| POST | `/admin/products/:productId/variants` | **Implemented** | Create variant (201); rejects duplicate `optionKey` or SKU (409) |
| PATCH | `/admin/products/:productId/variants/:variantId` | **Implemented** | Update variant; regenerates `optionKey` if options change |
| POST | `/admin/products/:productId/images` | **Implemented** | Create image metadata (201); validates `objectKey` format |
| PATCH | `/admin/products/:productId/images/:imageId` | **Implemented** | Update image metadata |
| DELETE | `/admin/products/:productId/images/:imageId` | **Implemented** | Delete image (204) |
| GET | `/admin/categories` | **Implemented** | List categories (query: `q`, `includeInactive`, `page`, `pageSize`) |
| GET | `/admin/categories/:categoryId` | **Implemented** | Category detail with parent, product/child counts |
| POST | `/admin/categories` | **Implemented** | Create category (201); rejects duplicate slug (409), max 2-level nesting |
| PATCH | `/admin/categories/:categoryId` | **Implemented** | Update category; rejects self-referencing parent |
| GET | `/admin/inventory` | **Implemented** | Inventory listing (query: `q`, `lowStockOnly`, `categoryId`, `page`, `pageSize`); includes `isLowStock` flag |
| GET | `/admin/inventory/movements` | **Implemented** | Movement history (query: `variantId`, `reason`, `page`, `pageSize`) |
| GET | `/admin/inventory/:variantId` | **Implemented** | Variant stock detail with 20 most recent movements |
| POST | `/admin/inventory/adjustments` | **Implemented** | Adjust stock (201); conditional atomic write; reasons: `ADMIN_ADJUSTMENT`, `DAMAGE`, `RETURN`, `IMPORT_CORRECTION`; inserts low-stock outbox alert when at/below threshold |
| GET | `/admin/orders` | **Implemented (M8)** | List orders (query: `q` matches order number or email, `status`, `paymentStatus`, `paymentMethod`, `page`, `pageSize`) |
| GET | `/admin/orders/:orderId` | **Implemented** | Order detail, plus `customer`, `allowedTransitions`, `history` (with actor and note), all `payments` (with `failureCode`) and `refundsDetail` |
| POST | `/admin/orders/:orderId/transitions` | **Implemented (M8)** | `{from, to, note?, carrier?, trackingNumber?}`; forward-only fulfilment or cancellation |
| POST | `/admin/orders/:orderId/cod-collection` | **Implemented (M8)** | Record cash collected; only once shipped; idempotent |
| POST | `/admin/orders/:orderId/refunds` | **Implemented (M8)** | `Idempotency-Key` + `{amountMinor, reason}`; `201` new, `200` + `meta.replayed` repeat |
| POST | `/admin/payments/:paymentId/hold-resolution` | **Implemented (M8)** | `{decision: accept\|reject, note}` for a held payment |
| GET | `/admin/customers` | **Implemented** | Customer search/list |
| PATCH | `/admin/customers/:userId/status` | **Implemented** | Account status |
| PATCH | `/admin/customers/:userId/role` | **Implemented** | Role change (SUPERADMIN only) |
| GET | `/admin/jobs` | **Implemented (M9)** | Outbox jobs (query: `status`, `type`, `page`, `pageSize`); never returns payloads |
| GET | `/admin/jobs/summary` | **Implemented (M9)** | Counts by status, `due`, `retryableDead`, `oldestDueAt`, and the payment sweep's last/next run |
| POST | `/admin/jobs/:jobId/retry` | **Implemented (M9)** | Requeue one `FAILED`/`DEAD` job with fresh tries; audited |
| GET | `/admin/assistant/conversations` | **Implemented (M13)** | Assistant chats, newest first (query: `owner=guest` or `customer`, `failed=true`, `page`, `pageSize`): counts, failed replies and tokens; **no chat text** |
| GET | `/admin/assistant/conversations/:conversationId` | **Implemented (M13)** | One chat with its text, provider, tools, tokens, latency and error per reply; **every read is audited** (`assistant.conversation.viewed`) |
| POST | `/admin/jobs/retry` | **Implemented (M9)** | `{status: "DEAD", type?}`: requeue up to 500 dead jobs; answers `{retried, remaining}`; audited |
| GET | `/admin/coupons` | **Implemented (M10)** | List (query: `q` code, `state` active/scheduled/expired/inactive/used_up, `page`, `pageSize`) |
| POST | `/admin/coupons` | **Implemented (M10)** | Create (201): `{code, type: PERCENT, percentBps}` or `{code, type: FIXED, valueMinor}`, plus `minimumSpendMinor`, `maxDiscountMinor`, `startsAt`, `endsAt`, `usageLimit`, `perUserLimit`, `isActive`, `appliesToAllProducts`, `productIds`; duplicate code `409`; audited |
| GET | `/admin/coupons/:couponId` | **Implemented (M10)** | One coupon, with its products and `usedCount` |
| PATCH | `/admin/coupons/:couponId` | **Implemented (M10)** | Change anything but code and type; a usage limit below the uses made is `409`; audited |
| GET | `/admin/settings` | **Implemented (M10)** | Store settings, or the defaults with `version: 0` |
| PUT | `/admin/settings` | **Implemented (M10)** | Every field plus the `version` loaded; a newer save is `409`; audited with what changed |
| GET | `/admin/audit-logs` | **Implemented (M10)** | Read-only (query: `action`, `entityType`, `entityId`, `actorUserId`, `from`, `to`, `page`, `pageSize`); `ipAddress` for superadmins only |
| GET | `/admin/reports/orders.csv` | **Implemented (M10)** | CSV of orders placed in `from`–`to` (optional `status`); at most 366 days and 10,000 rows (`400` beyond); formula-safe; `no-store`; audited |

**Orders, fulfilment and refunds (M8, [ADR 0020](decisions/0020-order-management-cancellation-refunds.md)).**
Every write takes the order row lock, and every write but a repeat records an `audit_logs` row.

| Endpoint | Outcome | Status |
|---|---|---|
| transitions | Moved, or already at `to` (no second effect) | `200`, admin detail |
| transitions | `from`→`to` not allowed (skipping, backwards, or to `CONFIRMED`/`PAYMENT_FAILED`) | `400 VALIDATION_ERROR` |
| transitions | The order is no longer at `from` | `409 CONFLICT` |
| transitions | `carrier`/`trackingNumber` with a `to` other than `SHIPPED` | `400` |
| cod-collection | Not a COD order, not yet shipped, or nothing to collect | `409` |
| refunds | More than is still refundable (pending refunds count), or nothing paid | `409 CONFLICT` |
| refunds | Same key, different amount or reason | `409 IDEMPOTENCY_CONFLICT` |
| refunds | Missing key, or `amountMinor` < 1 | `400` |
| hold-resolution | Not held; or `accept` for a hold other than a risk hold | `409` |

A new online refund answers `201` once it is written, whether or not the provider answered. Its
`status` is `PENDING`, and `providerAcknowledged` says whether SSLCOMMERZ accepted it. It becomes
`SUCCEEDED` when the bank completes it, as recorded by the sweep. A refund of collected cash is
`SUCCEEDED` at once and never reaches the provider. The refund's own id is sent as `refund_trans_id` on
every attempt.

**Background jobs (M9, [ADR 0021](decisions/0021-outbox-worker-and-email-delivery.md)).** A job is
described by `eventType`, `status` (`PENDING`, `PROCESSING`, `SENT`, `FAILED` = retry scheduled,
`DEAD` = gave up), `attemptCount`/`maxAttempts` (`null` for the recurring sweep), `nextAttemptAt`
(`null` once finished), a redacted `lastError`, `retryable`, and `subject`: an allow-list of
identifiers (`orderId`, `orderNumber`, `refundId`, `paymentId`, `variantId`, `sku`). Email addresses
and account links are never returned.

| Endpoint | Outcome | Status |
|---|---|---|
| retry | Requeued (`PENDING`, `attemptCount` 0, due now) | `200`, the job |
| retry | Already `SENT`, or `PENDING`/`PROCESSING`; or a concurrent retry won | `409 CONFLICT` |
| retry | An account email whose link was removed (expired or finished) | `409 CONFLICT` |
| retry | Unknown id | `404` |
| bulk retry | `status` other than `DEAD`, or an unknown `type` | `400` |

Prefer archive/deactivate over deleting entities with history. Bulk operations need bounded size, validation, authorization and per-item results.

## 8a. Shopping assistant
**Implemented** in `backend/src/modules/assistant/` ([ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md)). Open to guests and customers; `withActor` attaches the session when there is one.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/assistant/status` | Public | `{enabled, providers}`: `false` when keys are missing, and the widget is hidden |
| POST | `/assistant/messages` | Public (Origin check, `assistant` limiter) | Body `{message, conversationId?, guestToken?}` (strict; message 1–1000 chars). Answers `text/event-stream` |
| GET | `/assistant/conversations/:conversationId` | Owner | The owner's messages, to resume. A guest sends the token in `X-Assistant-Token`, never the URL |

**Stream events:** `meta` `{conversationId, guestToken?, provider}` comes first, and carries `guestToken` only when a guest conversation is created. Then any number of `delta` `{text}`, `products` `{items: ProductCard[]}` (read live through the catalog) and `sources` `{items: [{title, path, draft}]}`. The stream ends with `done` `{messageId, usage}` or `error` `{code, message}`.

**Refusals happen before the stream starts and are ordinary JSON errors:**

| Status | When |
|---|---|
| `400` | Validation |
| `403` | Foreign Origin |
| `404` | A conversation that is not the caller's. This looks the same as one that does not exist |
| `429` | The limiter, a full conversation (40 messages), or the day's allowance: tokens per customer, messages per guest IP |
| `503 PROVIDER_UNAVAILABLE` | No provider is configured, or every provider failed before answering |

**Provider failures:** a Groq failure before any text has been sent moves the turn to OpenAI (on Groq alone there is no fallback, so it answers 503 `PROVIDER_UNAVAILABLE`). A failure after text has been sent ends the stream with an `error` event.

**Tools:** the model may only call read-only tools. The order tools are offered only with a session, and they take the customer from the session, never from the model.

## 9. State transition rules
Payment transitions: ADR 0019. Order transitions: ADR 0020 and `orders/order-state.ts`.
- Order: `PENDING_PAYMENT -> CONFIRMED` only on verified payment; terminal failure -> `PAYMENT_FAILED`, and `PAYMENT_FAILED -> CONFIRMED` if money arrives late and the stock can be re-claimed. By a person, forward only: `CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED`; `CANCELLED` from `PENDING_PAYMENT`, `CONFIRMED` or `PROCESSING` (a customer only from the first two). `DELIVERED`, `CANCELLED` and `PAYMENT_FAILED` are final. COD collection is its own state (`COD_PENDING -> COD_COLLECTED`), recorded once shipped.
- Payment: `PENDING -> SUCCEEDED`; `PROCESSING` means received but held for a person (wrong amount, risk); pending/processing may become `FAILED` or `CANCELLED`; those may become `SUCCEEDED` if money arrives late; succeeded may become `PARTIALLY_REFUNDED -> REFUNDED` (M8). A failure never overturns a success.
- Reservation: `ACTIVE -> CONSUMED|RELEASED|EXPIRED`, at most once.

## 10. Abuse controls
Rate-limit login/register/reset, suggestions, coupon attempts, checkout, guest order lookup, upload signing and admin bulk actions. Ensure webhook protection respects provider retries and does not block legitimate events.

## 11. Contract tests
Test malformed input, auth/ownership, response/status, duplicate requests, concurrency, invalid transitions, external provider failure/timeouts, pagination bounds, allow-listed filters and private-field leakage.
