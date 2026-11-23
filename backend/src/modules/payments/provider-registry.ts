import { env } from '../../config/env.js';
import type { PaymentProvider } from './provider.js';
import { createSslcommerzProvider } from './sslcommerz.js';

/**
 * The configured online provider, or `null` when the store has no credentials. One provider for
 * now (PRD §4 FR-06). A stored `Payment.provider` is looked up by name, because it names who holds
 * the money for that row whatever is configured later.
 */
let cached: PaymentProvider | null | undefined;

export function onlineProvider(): PaymentProvider | null {
  if (cached === undefined) {
    cached =
      env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD
        ? createSslcommerzProvider({
            baseUrl: env.SSLCOMMERZ_BASE_URL,
            storeId: env.SSLCOMMERZ_STORE_ID,
            storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
          })
        : null;
  }

  return cached;
}

export function providerByName(name: string): PaymentProvider | null {
  const provider = onlineProvider();

  return provider?.name === name ? provider : null;
}

export type OfferedPaymentMethod = 'COD' | 'ONLINE';

/**
 * What a customer may choose for this total. Pure, so "no credentials" and the provider's amount
 * limits can be tested directly. `totalMinor` is `null` until the address, and so the fee, is known.
 */
export function paymentMethodsFor(
  provider: Pick<PaymentProvider, 'minAmountMinor' | 'maxAmountMinor'> | null,
  totalMinor: number | null,
): readonly OfferedPaymentMethod[] {
  if (!provider) {
    return ['COD'];
  }

  const withinLimits =
    totalMinor === null ||
    (totalMinor >= provider.minAmountMinor && totalMinor <= provider.maxAmountMinor);

  return withinLimits ? ['COD', 'ONLINE'] : ['COD'];
}
