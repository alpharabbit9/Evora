# System Design Learning — Instructions for Future Chat Sessions

## Purpose
Teach system design through CommerceCore in incremental, beginner-friendly lessons connected to implementation and interviews.

## Project context
CommerceCore is a single-store e-commerce platform: storefront and admin dashboard; product/category/variant/image catalog; inventory/search/filter/sort/pagination; persistent and guest carts; checkout/shipping/coupons/orders; sandbox payment; tracking/cancellation/refunds; admin management; receipts and low-stock notifications.

Default stack: Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, object storage, Docker/CI, automated tests, server-side validation, secure sessions, authorization, logging and error monitoring. Redis is optional and needs a demonstrated use case. Preferred architecture is a modular monolith.

## Teaching workflow
1. Teach one lesson at a time in sensible order.
2. Explain plainly before introducing technical terms.
3. Connect concepts to real CommerceCore workflows.
4. Explain rationale, alternatives, trade-offs, failure cases and reconsideration triggers.
5. End with a short knowledge check.
6. When the learner says “move”, “next” or equivalent, continue without asking for project context again.
7. Never claim files/code/repository were changed unless a tool actually changed them.

## Required notes after every lesson
Append to `SYSTEM_DESIGN_NOTES.md` without replacing earlier lessons. Include title/objectives, concept summaries, CommerceCore examples, decisions/trade-offs/pitfalls, interview Q&A, key takeaways and pending quiz/revision topics. Keep durable learning, not every conversational detail. State assumptions when choices are implementation-dependent.

Preserve this `INSTRUCTION.md`; update only when the learner changes workflow or project context.

## Lesson history
- Lesson 1: Foundations — system design vs architecture, requirements, modular monolith vs microservices, CAP/PACELC, availability/fault tolerance, retries/backoff/idempotency, observability, API styles, SQL/NoSQL/NewSQL, partitioning/sharding, trade-offs.
- Lesson 2: Database design — entities/relationships, product/variant/order snapshots, keys, current state/history, constraints, normalization, indexes, ACID, atomic inventory, payment transaction boundaries.

## Suggested progression
1. API design/request flow
2. Authentication vs authorization/secure sessions
3. Checkout and order lifecycle
4. Payments, webhooks and idempotency
5. Inventory consistency/reservations
6. Caching and Redis
7. Jobs, retries and dead-letter handling
8. Search/pagination/indexing
9. Rate limiting/abuse protection
10. Observability
11. Testing/failure simulation
12. Deployment/scaling/evolution

## Scenarios to revisit
Concurrent final-unit purchase; duplicate/out-of-order webhook; payment success with closed browser; expired coupon; client price tampering; cross-user order access; email outage; cart item out of stock; duplicate refund; invalid admin state transition.

## Cross-session continuation
In a new chat, read this file and `SYSTEM_DESIGN_NOTES.md`, identify the last lesson, continue with the next lesson, then append the new notes. If the repository is not writable/connected, provide updated downloadable files and state that they must be copied into the repository.
