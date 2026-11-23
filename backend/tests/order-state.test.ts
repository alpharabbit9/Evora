import type { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_TRANSITIONS,
  canCustomerCancel,
  canTransition,
} from '../src/modules/orders/order-state.js';

const ALL: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
];

describe('order transitions', () => {
  it('follows fulfilment forward, one step at a time', () => {
    expect(canTransition('CONFIRMED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('refuses skipping a step and going backwards', () => {
    expect(canTransition('CONFIRMED', 'SHIPPED')).toBe(false);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('SHIPPED', 'PROCESSING')).toBe(false);
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
  });

  it('lets the store cancel only before the goods leave', () => {
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('PROCESSING', 'CANCELLED')).toBe(true);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('never lets a person confirm an order: only verified payment does that', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'CONFIRMED')).toBe(false);
      expect(canTransition(from, 'PAYMENT_FAILED')).toBe(false);
    }
  });

  it('closes terminal states completely', () => {
    for (const closed of ['DELIVERED', 'CANCELLED', 'PAYMENT_FAILED'] as const) {
      expect(ADMIN_TRANSITIONS[closed]).toEqual([]);
    }
  });

  it('has no transition to the same status', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe('customer cancellation', () => {
  it('is allowed only before the order is being prepared', () => {
    expect(ALL.filter(canCustomerCancel)).toEqual(['PENDING_PAYMENT', 'CONFIRMED']);
  });
});
