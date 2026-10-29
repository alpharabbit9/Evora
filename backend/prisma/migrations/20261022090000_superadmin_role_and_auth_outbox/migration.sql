-- M2 — identity and authorization.
--
-- HAND-WRITTEN, not generated. `prisma migrate dev` output for this change also emits
-- DROP CONSTRAINT / DROP INDEX lines for the hand-written CHECKs and partial unique indexes
-- added by migrations 0001-0005 (see the header of prisma/schema.prisma). This file therefore
-- contains only the two additive enum changes and touches no table, column or row.
--
-- PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE inside a transaction block as long as the
-- new value is not USED in that same transaction. Nothing below uses them, so this is safe
-- under Prisma's transactional migration runner.

-- Granting a role must not itself be an ADMIN-level operation (PRD §4 FR-05, least privilege).
-- Appended last so no existing value's sort position changes.
ALTER TYPE "UserRole" ADD VALUE 'SUPERADMIN';

-- Better Auth produces a verification/password-reset URL and hands it to a send function.
-- That send is routed through the durable outbox instead of an inline provider call, so an
-- email outage cannot break sign-up or password reset (architecture.md §11, invariant 9).
-- The delivery worker itself is M9; until it exists these rows accumulate as PENDING.
ALTER TYPE "OutboxEventType" ADD VALUE 'EMAIL_VERIFICATION';
ALTER TYPE "OutboxEventType" ADD VALUE 'PASSWORD_RESET';
