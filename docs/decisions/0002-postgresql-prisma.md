# ADR 0002 — PostgreSQL with Prisma
- **Status:** Accepted
- **Date:** 2026-10-21
- **Context:** Users, catalog, carts, orders, payments and inventory have relational integrity and transaction requirements.
- **Decision:** PostgreSQL is source of truth; Prisma provides typed data access and migration management.
- **Consequences:** Constraints/transactions available; migrations require review; SQL CHECK constraints may supplement ORM schema; money uses exact decimals or integer minor units.
- **Alternatives:** NoSQL-first or multiple databases initially.
- **Revisit when:** Requirements demonstrate a concrete need not met by PostgreSQL.
