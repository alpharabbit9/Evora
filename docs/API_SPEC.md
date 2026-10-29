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
| GET | `/search/suggestions?q=` | — | **Not built** |

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
Coupons are not built (M5/M10); checkout is M6.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/cart` | Session or guest token | Read current cart, re-priced (never creates one) |
| POST | `/cart/items` | Session or guest token | Add `{variantId, quantity}`; creates the cart and guest cookie if needed |
| PATCH | `/cart/items/:itemId` | Cart owner | Set `{quantity}` |
| DELETE | `/cart/items/:itemId` | Cart owner | Remove item |
| POST | `/cart/merge` | — | **Replaced**: a signed-in request carrying a guest cookie merges on any cart call |
| POST/DELETE | `/cart/coupon` | — | **Not built** |

Bodies are strict: a `priceMinor`, total or stock field is a `400`. Quantity is 1–10 per line, at most
50 lines. Add/raise checks the variant passes the publication rule (`404`), has stock (`409
OUT_OF_STOCK`), and the resulting line fits stock and the cap; a failure rolls the change back.
Every response is the whole cart: `items[]` with `status` (`available | insufficient_stock |
out_of_stock | unavailable`), current `unitPriceMinor`/`lineTotalMinor`, `itemCount`,
`subtotalMinor` (available lines only) and `hasIssues`. Another owner's line is a `404`.
The guest token is a 256-bit value in the httpOnly `commercecore.cart` cookie (path `/api/v1/cart`),
stored only as a SHA-256 hash. Cart totals are estimates until checkout; stock is not reserved.

## 6. Checkout and orders
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/checkout/quote` | Guest/session | Recalculate current pricing, coupon, shipping, tax and availability |
| POST | `/checkout` | Guest/session + idempotency | Create order and payment session/intent |
| GET | `/orders` | Session | List own orders |
| GET | `/orders/:orderId` | Owner/admin | Order detail |
| POST | `/orders/:orderId/cancel-request` | Owner | Request cancellation if eligible |
| POST | `/orders/:orderId/refund-request` | Owner | Request refund if eligible |
| GET | `/orders/:orderId/tracking` | Owner/admin | Tracking timeline |

Checkout body contains variant IDs/quantities, contact/shipping details, delivery option, coupon code, payment method and `Idempotency-Key`; it must not accept authoritative prices/totals. Store request fingerprint and prior result. Same key + same logical request returns prior result; same key + different payload returns `409 IDEMPOTENCY_CONFLICT`. Guest order lookup requires unguessable access token or verified contact flow, never a sequential public ID alone.

## 7. Payments and webhook
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/payments/:paymentId` | Order owner/admin | Read safe status |
| POST | `/webhooks/payments/:provider` | Provider signature | Provider event |

Read raw body as required; verify official signature before state changes; deduplicate by provider/event ID; validate transitions. Never let a client set payment status to `PAID`. Implement provider-specific acknowledgement and retry behavior. Redact payloads in logs.

## 8. Admin API
All routes require server-side admin authorization.

**Implemented so far (M2):** `GET /admin/customers`,
`PATCH /admin/customers/:userId/status` (ADMIN; suspending also revokes that user's
sessions), `PATCH /admin/customers/:userId/role` (**SUPERADMIN only** — see ADR 0009) and
`GET /admin/orders/:orderId`. Both customer writes record an `audit_logs` row in the same
transaction as the change. Everything else in this table belongs to M3-M10 and is not built;
when it lands it goes behind the same router guard.
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/overview?from=&to=` | Metrics |
| GET/POST | `/admin/products` | List/create products |
| GET/PATCH | `/admin/products/:productId` | Read/update product |
| POST | `/admin/products/:productId/archive` | Archive/unpublish |
| POST | `/admin/products/:productId/images` | Image metadata/upload flow |
| GET/POST | `/admin/categories` | List/create categories |
| PATCH | `/admin/categories/:categoryId` | Update category |
| GET | `/admin/inventory` | Inventory listing |
| POST | `/admin/inventory/adjustments` | Adjust stock with reason |
| GET | `/admin/orders` | Search/filter orders |
| GET | `/admin/orders/:orderId` | Order detail |
| POST | `/admin/orders/:orderId/transitions` | Valid fulfillment transition |
| POST | `/admin/orders/:orderId/refunds` | Authorized refund |
| GET | `/admin/customers` | Customer search/list |
| PATCH | `/admin/customers/:userId/status` | Account status |
| GET/POST | `/admin/coupons` | List/create coupons |
| PATCH | `/admin/coupons/:couponId` | Update coupon |
| GET | `/admin/audit-logs` | Audit search |
| GET | `/admin/reports/sales` | Report/export |

Prefer archive/deactivate over deleting entities with history. Bulk operations need bounded size, validation, authorization and per-item results.

## 9. State transition rules
Illustrative; finalize in implementation and tests.
- Order: `PENDING_PAYMENT -> CONFIRMED` only on verified payment; terminal failure -> `PAYMENT_FAILED`; fulfillment `CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED`. Cancellation/refund rules depend on fulfillment/payment state. COD needs separate collection state.
- Payment: `PENDING -> PROCESSING -> SUCCEEDED`; pending/processing may become `FAILED`; succeeded may become `PARTIALLY_REFUNDED -> REFUNDED` where supported. Out-of-order events must not regress state without reconciliation.
- Reservation: `ACTIVE -> CONSUMED|RELEASED|EXPIRED`, at most once.

## 10. Abuse controls
Rate-limit login/register/reset, suggestions, coupon attempts, checkout, guest order lookup, upload signing and admin bulk actions. Ensure webhook protection respects provider retries and does not block legitimate events.

## 11. Contract tests
Test malformed input, auth/ownership, response/status, duplicate requests, concurrency, invalid transitions, external provider failure/timeouts, pagination bounds, allow-listed filters and private-field leakage.
