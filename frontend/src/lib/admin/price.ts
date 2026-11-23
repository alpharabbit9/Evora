/**
 * Between what an admin types (`2850.50`) and the integer minor units the API stores (ADR 0008).
 * Works on the string, not through a float: `19.99 * 100` is `1998.9999999999998`. Nothing here
 * makes a price authoritative; the API validates the integer it is sent.
 */
const MAJOR_AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;

export function isMajorAmount(value: string): boolean {
  return MAJOR_AMOUNT.test(value.trim());
}

export function majorToMinor(value: string): number {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function minorToMajor(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${String(whole)}.${String(fraction).padStart(2, '0')}`;
}
