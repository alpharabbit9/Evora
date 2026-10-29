# ADR 0008 — Integer Minor Units and a Single Store Currency

- **Status:** Accepted
- **Date:** 2026-10-21
- **Resolves:** the open choice in `docs/database-design.md` §1/§7 and `docs/PRD.md` §6 rule 1.

## Context
`database-design.md` §1 allowed either "integer minor units **or** exact decimal types", §7
said to "choose a store currency for v1", and the variant entity mentioned only a vague
"currency policy". Three money-bearing migrations were about to be written against that
ambiguity. Mixing representations across tables — minor units on one, `Decimal` on another —
is the kind of inconsistency that produces off-by-one-cent drift that nobody notices until
reconciliation.

## Decision
1. **Every persisted monetary amount is an integer count of minor units**, in a column named
   `*Minor` (`priceMinor`, `subtotalMinor`, `unitPriceMinor`, …), typed `Int`.
2. **Percentages are integer basis points** (`percentBps`, 1000 = 10.00%), so a discount rate
   is never a float either.
3. **One store currency for v1.** It is not stored per catalog row. `currency CHAR(3)` is
   persisted on `Order`, `Payment` and `Refund` only — the records whose historical and
   provider-verification value depends on it. A database CHECK enforces upper-case ISO-4217
   shape; a cross-row currency match (order vs payment) is a service-level rule.
4. `OrderItem` does **not** carry its own currency: the order it belongs to governs. A
   duplicated per-line currency could diverge from the order's and no CHECK constraint can
   compare across rows without a trigger.

## Consequences
- No floating-point money anywhere, and no `Decimal.js` objects crossing the Prisma boundary.
- `Int` caps at 2,147,483,647 minor units, about 21.4 million major units per column. That is
  ample for a single store, but it is a ceiling: move to `BigInt` before a plausible order
  total approaches it. Revisit if a zero-decimal or three-decimal currency is adopted, since
  "minor units" then means a different exponent and the conversion is not a column change.
- Rounding becomes a single-place concern: percentage discounts and any future tax must round
  in one shared pricing module (M5), not at each call site. That module does not exist yet.
- Multi-currency is **not** supported, and adding it later is a real migration: catalog prices
  would need a currency dimension, not just an extra column.
- Provider verification is possible as required by `database-design.md` §7, because `Payment`
  persists the expected `amountMinor` and `currency` before the provider is called.

## Alternatives
- `Decimal(12, 2)`: exact, and natural in SQL, but Prisma returns Decimal.js instances in
  TypeScript, which invite accidental `Number()` conversions and make arithmetic verbose.
- Per-variant currency columns from day one: carries multi-currency cost before there is a
  multi-currency requirement, and leaves every price nullable-by-currency.

## Amendment — store currency selected (2026-10-27)
The project owner chose **BDT** (Bangladeshi taka; minor unit poisha, exponent 2) as the single
store currency. Every `*Minor` catalog amount is therefore poisha: `priceMinor = 450000` is
৳4,500.00. The `Int` ceiling is ~৳21.4M per column, still ample for one order. Tooling that
writes prices reads it from `STORE_CURRENCY` (currently only the catalog importer, see
[ADR 0011](0011-catalog-import-provenance.md)) and refuses any other value rather than guessing.
No source price in another currency is converted implicitly; a conversion would need its own
documented rule.

## Revisit when
A second selling currency becomes a real requirement, a zero-decimal currency is adopted, or
measured order values approach the `Int` ceiling.
