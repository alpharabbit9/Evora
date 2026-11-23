-- M7 (ADR 0019): a durable signal that a person must look at a payment, for example money that
-- arrived after its order closed. Additive: no existing row or constraint is touched.
ALTER TYPE "OutboxEventType" ADD VALUE 'PAYMENT_REVIEW_REQUIRED';
