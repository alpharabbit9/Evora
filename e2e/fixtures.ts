/**
 * What `backend/scripts/e2e/prepare.ts` writes. Mirrored there as `E2E_PRODUCT`; change both.
 *
 * The admin credentials are test values for the throwaway E2E database only. They are not used
 * anywhere else and must never be reused for a real account.
 */
export const E2E_PRODUCT = {
  slug: 'e2e-field-jacket',
  name: 'E2E Field Jacket',
  /** ৳4,500.00 — 450,000 poisha. */
  priceMinor: 450_000,
  inStockSizes: ['M', 'L'],
  soldOutSize: 'S',
} as const;

export const E2E_ADMIN = {
  email: 'e2e-superadmin@commercecore.test',
  password: 'E2E-only-Superadmin-Passw0rd',
} as const;

/** Satisfies the 12-character minimum; registered customers all use it. */
export const CUSTOMER_PASSWORD = 'E2E-only-Customer-Passw0rd';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export const SHIPPING_ADDRESS = {
  recipientName: 'Rahim Uddin',
  phone: '01712345678',
  line1: 'House 12, Road 5, Dhanmondi',
  city: 'Dhaka',
  postalCode: '1205',
} as const;
