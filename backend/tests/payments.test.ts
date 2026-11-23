import { describe, expect, it } from 'vitest';

import { signFakeIpn } from '../scripts/payments/fake-sslcommerz.js';
import {
  type PaymentFacts,
  canResumePayment,
  decide,
} from '../src/modules/payments/payment-state.js';
import type { ProviderStatus } from '../src/modules/payments/provider.js';
import { paymentMethodsFor } from '../src/modules/payments/provider-registry.js';
import {
  computeVerifySign,
  createSslcommerzProvider,
  decimalToMinor,
  minorToDecimal,
} from '../src/modules/payments/sslcommerz.js';

const STORE = { baseUrl: 'http://unused.invalid', storeId: 'store', storePassword: 'secret' };
const provider = createSslcommerzProvider(STORE);

describe('money conversion', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [1000, '10.00'],
    [258_000, '2580.00'],
    [123_456, '1234.56'],
  ])('writes %i minor units as %s', (minor, decimal) => {
    expect(minorToDecimal(minor)).toBe(decimal);
    expect(decimalToMinor(decimal)).toBe(minor);
  });

  it('is exact where a float would not be', () => {
    // 1.1 * 100 is 110.00000000000001 in binary floating point.
    expect(decimalToMinor('1.10')).toBe(110);
    expect(decimalToMinor('19.99')).toBe(1999);
    expect(decimalToMinor('1000.0000')).toBe(100_000);
    expect(decimalToMinor('100')).toBe(10_000);
    expect(decimalToMinor(100)).toBe(10_000);
  });

  it('refuses anything it cannot represent, rather than rounding it into a match', () => {
    for (const bad of ['10.001', '-10.00', '1e3', '', 'abc', '10,00', null, undefined, {}]) {
      expect(decimalToMinor(bad)).toBeNull();
    }
  });
});

describe('notification signature', () => {
  const fields = { status: 'VALID', tran_id: 'pay_1', val_id: 'val_1', amount: '100.00' };

  it('agrees with a separately written implementation of the algorithm', () => {
    const signed = signFakeIpn(fields, STORE.storePassword);

    expect(computeVerifySign(signed, Object.keys(fields), STORE.storePassword)).toBe(
      signed.verify_sign,
    );
  });

  it('accepts a correctly signed message and reports what it claims', () => {
    expect(provider.verifyNotification(signFakeIpn(fields, STORE.storePassword))).toMatchObject({
      eventId: 'pay_1:VALID:val_1',
      reference: 'pay_1',
      claim: { kind: 'succeeded' },
    });
  });

  it('refuses a message signed with another password', () => {
    expect(provider.verifyNotification(signFakeIpn(fields, 'not-the-password'))).toBeNull();
  });

  it('refuses a message changed after signing', () => {
    const signed = signFakeIpn({ ...fields, status: 'FAILED' }, STORE.storePassword);

    expect(provider.verifyNotification({ ...signed, status: 'VALID' })).toBeNull();
  });

  it('refuses a validly signed message that leaves a field we act on out of the signature', () => {
    // verify_key comes from the message, so a forger picks what is covered.
    const withoutStatus = signFakeIpn(fields, STORE.storePassword, ['tran_id', 'val_id', 'amount']);
    const withoutValId = signFakeIpn(fields, STORE.storePassword, ['status', 'tran_id', 'amount']);

    expect(provider.verifyNotification(withoutStatus)).toBeNull();
    expect(provider.verifyNotification(withoutValId)).toBeNull();
  });

  it('refuses a message for another store, and one with no signature', () => {
    const elsewhere = signFakeIpn({ ...fields, store_id: 'other' }, STORE.storePassword);

    expect(provider.verifyNotification(elsewhere)).toBeNull();
    expect(provider.verifyNotification(fields)).toBeNull();
    expect(provider.verifyNotification({})).toBeNull();
  });

  it('does not let a message supply the password field itself', () => {
    const forged = signFakeIpn(
      { ...fields, store_passwd: 'known-to-attacker' },
      'known-to-attacker',
    );

    expect(provider.verifyNotification(forged)).toBeNull();
  });

  it('is not confused by keys that exist on every object', () => {
    const signed = signFakeIpn(fields, STORE.storePassword);
    const hostile = { ...signed, verify_key: `${String(signed.verify_key)},__proto__,constructor` };

    expect(() => provider.verifyNotification(hostile)).not.toThrow();
    expect(provider.verifyNotification(hostile)).not.toBeNull();
  });

  it.each([
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'CANCELLED'],
    ['EXPIRED', 'EXPIRED'],
  ] as const)('reads %s as a failure', (status, code) => {
    const signed = signFakeIpn({ status, tran_id: 'pay_1', val_id: '' }, STORE.storePassword);

    expect(provider.verifyNotification(signed)?.claim).toEqual({ kind: 'failed', code });
  });

  it('reads an unknown status as saying nothing, never as a failure or a success', () => {
    const signed = signFakeIpn({ status: 'NEW_STATUS', tran_id: 'pay_1' }, STORE.storePassword);

    expect(provider.verifyNotification(signed)?.claim).toEqual({ kind: 'pending' });
  });
});

describe('state machine', () => {
  const open: PaymentFacts = {
    paymentStatus: 'PENDING',
    orderStatus: 'PENDING_PAYMENT',
    providerRef: null,
    amountMinor: 100_000,
    currency: 'BDT',
  };
  const paid: ProviderStatus = {
    kind: 'succeeded',
    providerRef: 'val_1',
    amountMinor: 100_000,
    currency: 'BDT',
    riskLevel: 0,
  };
  const failed: ProviderStatus = { kind: 'failed', code: 'FAILED' };
  const closed: PaymentFacts = { ...open, paymentStatus: 'FAILED', orderStatus: 'PAYMENT_FAILED' };
  const settled: PaymentFacts = {
    ...open,
    paymentStatus: 'SUCCEEDED',
    orderStatus: 'CONFIRMED',
    providerRef: 'val_1',
  };

  it('confirms an open payment on verified success', () => {
    expect(decide(open, paid)).toEqual({ type: 'confirm', late: false });
  });

  it('fails an open payment', () => {
    expect(decide(open, failed)).toEqual({ type: 'fail', code: 'FAILED' });
  });

  it('does nothing on no news', () => {
    expect(decide(open, { kind: 'pending' })).toEqual({ type: 'none' });
    expect(decide(settled, { kind: 'pending' })).toEqual({ type: 'none' });
  });

  it('never lets a failure overturn a recorded success', () => {
    expect(decide(settled, failed)).toEqual({ type: 'none' });
    expect(decide({ ...settled, paymentStatus: 'REFUNDED' }, failed)).toEqual({ type: 'none' });
  });

  it('lets a success overturn a recorded failure, because money moved', () => {
    expect(decide(closed, paid)).toEqual({ type: 'confirm', late: true });
  });

  it('treats a repeat of a recorded success as nothing, and a different capture as a problem', () => {
    expect(decide(settled, paid)).toEqual({ type: 'none' });
    expect(decide(settled, { ...paid, providerRef: 'val_2' })).toEqual({
      type: 'review',
      reason: 'DUPLICATE_CAPTURE',
    });
  });

  it('holds a payment whose amount or currency is not what was charged', () => {
    const hold = { type: 'hold', reason: 'AMOUNT_MISMATCH' };

    expect(decide(open, { ...paid, amountMinor: 1 })).toEqual(hold);
    expect(decide(open, { ...paid, amountMinor: null })).toEqual(hold);
    expect(decide(open, { ...paid, currency: 'USD' })).toEqual(hold);
    expect(decide(open, { ...paid, currency: null })).toEqual(hold);
  });

  it('holds a risky payment', () => {
    expect(decide(open, { ...paid, riskLevel: 1 })).toEqual({
      type: 'hold',
      reason: 'RISK_REVIEW',
    });
  });

  it('does not reopen a closed payment for a success it cannot trust', () => {
    expect(decide(closed, { ...paid, amountMinor: 1 })).toEqual({
      type: 'review',
      reason: 'AMOUNT_MISMATCH',
    });
  });

  it('records money for an order that cannot be revived', () => {
    expect(decide({ ...closed, orderStatus: 'CANCELLED' }, paid)).toEqual({ type: 'captureOnly' });
  });

  it('does not fail a payment under an order that has already moved on', () => {
    expect(decide({ ...open, orderStatus: 'CONFIRMED' }, failed)).toEqual({ type: 'none' });
  });

  it('offers the gateway only while the order is waiting and in time', () => {
    const createdAt = new Date('2026-11-09T12:00:00Z');
    const facts = { paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT', createdAt } as const;
    const inTime = new Date('2026-11-09T12:29:59Z');
    const tooLate = new Date('2026-11-09T12:30:00Z');

    expect(canResumePayment(facts, inTime)).toBe(true);
    expect(canResumePayment(facts, tooLate)).toBe(false);
    expect(canResumePayment({ ...facts, paymentStatus: 'PROCESSING' }, inTime)).toBe(false);
    expect(canResumePayment({ ...facts, orderStatus: 'CONFIRMED' }, inTime)).toBe(false);
  });
});

describe('what the store offers', () => {
  const limits = { minAmountMinor: 1_000, maxAmountMinor: 50_000_000 };

  it('offers cash on delivery alone with no provider configured', () => {
    expect(paymentMethodsFor(null, 100_000)).toEqual(['COD']);
    expect(paymentMethodsFor(null, null)).toEqual(['COD']);
  });

  it('offers online payment within the limits, inclusive, and not outside them', () => {
    expect(paymentMethodsFor(limits, 1_000)).toEqual(['COD', 'ONLINE']);
    expect(paymentMethodsFor(limits, 50_000_000)).toEqual(['COD', 'ONLINE']);
    expect(paymentMethodsFor(limits, 999)).toEqual(['COD']);
    expect(paymentMethodsFor(limits, 50_000_001)).toEqual(['COD']);
  });

  it('offers it while the total is still unknown', () => {
    expect(paymentMethodsFor(limits, null)).toEqual(['COD', 'ONLINE']);
  });
});
