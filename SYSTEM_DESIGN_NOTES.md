# CommerceCore — System Design Revision Notes & Interview Q&A

> Living document. Append a numbered lesson after each completed lesson; preserve prior notes.

## Contents
- [Lesson 1 — System Design Foundations](#lesson-1--system-design-foundations)
- [Lesson 2 — Database Design](#lesson-2--database-design)

---

# Lesson 1 — System Design Foundations

## Objectives
Understand system-design vocabulary and apply it to CommerceCore.

## Concepts
- **System design vs architecture:** system design decides how data, APIs, storage, reliability, security, scale and operations fit together; architecture defines major structural boundaries.
- **Functional vs non-functional requirements:** functional describes behavior; NFRs describe qualities such as latency, security, availability and maintainability. Make targets measurable.
- **Monolith vs microservices:** a modular monolith is one deployable app with clear internal boundaries. CommerceCore starts here to avoid premature distributed complexity.
- **CAP/PACELC:** CAP describes the consistency/availability trade-off during network partition; PACELC also considers latency/consistency without partition. Do not use these as simplistic labels for every operation.
- **Availability/fault tolerance:** availability measures whether a service can be used; fault tolerance is continued operation despite selected failures. Email failure should not invalidate an order.
- **Retries/backoff/idempotency:** retry transient errors with bounded exponential backoff/jitter; protect repeated operations against duplicate effects.
- **Observability:** logs record events, metrics summarize behavior, traces show request paths. Monitor checkout, webhooks, inventory conflicts, queues and email retries without logging secrets.
- **API styles:** REST models resources/HTTP operations; GraphQL lets clients select fields; RPC models operations. REST is a practical starting point.
- **SQL/NoSQL/NewSQL:** PostgreSQL suits relational orders/payments/inventory and transactions; add other stores only for clear needs.
- **Partitioning/sharding:** divide data logically/physically or across nodes; first tune queries/indexes, caching and vertical scale.
- **Trade-offs:** ask what requirement a choice solves, complexity added, failure behavior, test/observability strategy and when to revisit.

## Interview Q&A
**Q1. What is system design?** Deciding how components, data, APIs, infrastructure and operations fit together to meet functional and non-functional requirements.

**Q2. Functional vs NFR?** Functional requirements define behavior; NFRs define qualities/constraints such as latency, security and reliability.

**Q3. Why modular monolith first?** Simpler deployment/debugging with maintainable boundaries; microservices add network failures and distributed consistency complexity.

**Q4. When might microservices help?** When independent deployment/scaling, team ownership or isolation has demonstrated value.

**Q5. Explain CAP.** During a network partition, affected operations must trade off strong consistency and full availability.

**Q6. Why idempotency?** Retries must not create duplicate orders, payments or refunds.

**Q7. If email is down?** Keep the committed order valid; persist a notification job, retry and monitor failures.

**Q8. Logs vs metrics vs traces?** Events, numeric trends, and request paths/timing respectively.

**Q9. Why PostgreSQL?** Relational integrity and transactions are useful for orders, payments and inventory.

**Q10. Start with sharding?** No; optimize indexes, queries, safe caching and simpler scaling first.

## Remember
- Start from requirements and trade-offs.
- Prefer the simplest architecture that meets needs.
- Retries require idempotency or duplicate-effect protection.
- Design for provider failure; measure bottlenecks before adding distributed complexity.

---

# Lesson 2 — Database Design

## Objectives
Model domain data, preserve order history, enforce invariants and avoid inventory races.

## Concepts
- **Entities:** User, Address, Category, Product, ProductVariant, ProductImage, Cart/CartItem, Coupon, Order/OrderItem, Payment, InventoryMovement/Reservation, Refund, Review, WebhookEvent, Notification/OutboxEvent, AuditLog.
- **Product vs variant vs order item:** product is catalog concept; variant is purchasable configuration with SKU/price/stock; order item records the historical purchase.
- **Snapshots:** persist product name, SKU, unit price, quantity and necessary details on order item; do not recompute old orders from current catalog.
- **Keys:** primary key uniquely identifies row; foreign key enforces a valid reference. Avoid cascading deletion of historical orders.
- **Current state vs history:** stock balance supports fast reads; movement log explains why/how it changed.
- **Constraints/validation:** unique email/SKU/order number/provider event IDs, positive quantity, non-negative stock and valid FKs. Validate at API and DB layers.
- **Normalization:** reduce accidental duplication; intentional order snapshots preserve history.
- **Indexes:** speed selected reads but add storage/write overhead; base them on query plans.
- **ACID:** Atomicity all-or-nothing; Consistency preserves invariants; Isolation governs concurrency; Durability preserves committed data.
- **Atomic inventory:** avoid separate read/check/decrement. Use conditional update:

```sql
UPDATE product_variants
SET stock_quantity = stock_quantity - $1
WHERE id = $2 AND stock_quantity >= $1
RETURNING id, stock_quantity;
```

No row returned means stock was not claimed; perform related writes transactionally.
- **Payment transaction boundary:** never hold a DB transaction open during provider network call; use explicit state transitions, idempotent callbacks and reconciliation.

## Interview Q&A
**Q1. Why separate Product and ProductVariant?** Variants can have distinct SKUs, prices and stock.

**Q2. Why snapshot price on OrderItem?** To preserve historical purchase facts after price changes.

**Q3. Primary vs foreign key?** Unique row identity vs reference to another row.

**Q4. Why InventoryMovement?** Audit, reconciliation and debugging.

**Q5. Is duplication always bad?** No; snapshots are intentional duplication for historical correctness.

**Q6. Index trade-off?** Faster selected reads at storage/write cost.

**Q7. ACID?** Atomicity, Consistency, Isolation, Durability.

**Q8. Prevent overselling?** Conditional atomic stock update or suitable locking in a transaction.

**Q9. Why conditional update?** The stock check and decrement happen together, avoiding a read/write race.

**Q10. Should a transaction wait for payment provider?** Usually no; use short transactions and recoverable explicit states.

**Q11. Should browser send final price?** No; server computes price, coupon, shipping, tax and total from trusted data.

**Q12. Zero rows updated?** Treat stock claim as failed and do not proceed as if inventory was secured.

## Remember
- Inventory belongs to the purchasable variant.
- Preserve order snapshots.
- Enforce invariants in app and DB.
- Tune indexes using actual query plans.
- Keep transactions short and concurrency-safe.

## Pending revision
- Decide decrement-on-order vs timed reservation.
- Confirm transaction boundaries for selected payment provider.
- Next: Lesson 3 — API design and request flow.
