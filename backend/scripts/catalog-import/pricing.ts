import { stableHash } from './normalize.js';

/**
 * Synthetic DEMO prices and stock (decisions D3/D4, ADR 0011). The source's own price has no
 * stated currency and is never converted, so it is not used at all.
 *
 * Deterministic: the same product always gets the same price and the same initial stock, so a
 * fresh database rebuilt from scratch looks identical. Rows carry `priceSource = SYNTHETIC`.
 *
 * Bands are in MAJOR units of the store currency and only exist for currencies listed here; any
 * other STORE_CURRENCY refuses demo pricing rather than reusing BDT numbers under another code.
 */
interface Band {
  readonly min: number;
  readonly max: number;
}

export const BDT_BANDS: Record<string, Band> = {
  't-shirts': { min: 1_200, max: 2_800 },
  shirts: { min: 2_200, max: 4_800 },
  knitwear: { min: 2_800, max: 6_500 },
  hoodies: { min: 2_800, max: 5_800 },
  jeans: { min: 2_800, max: 5_500 },
  trousers: { min: 2_600, max: 5_200 },
  jackets: { min: 5_500, max: 14_000 },
  blazers: { min: 7_500, max: 16_000 },
  coats: { min: 9_500, max: 18_500 },
  dresses: { min: 3_200, max: 7_500 },
  'formal-shoes': { min: 4_500, max: 9_500 },
  sneakers: { min: 3_500, max: 8_500 },
  boots: { min: 6_500, max: 13_500 },
  sunglasses: { min: 1_800, max: 6_500 },
  wallets: { min: 1_200, max: 3_800 },
  belts: { min: 1_100, max: 3_200 },
  jewellery: { min: 900, max: 3_500 },
  handbags: { min: 3_500, max: 9_500 },
  'messenger-bags': { min: 3_200, max: 7_800 },
  'duffel-bags': { min: 3_800, max: 8_800 },
};

const BANDS_BY_CURRENCY: Record<
  string,
  { bands: Record<string, Band>; step: number; minorPerMajor: number }
> = {
  // Prices land on ৳50 steps; poisha = 1/100 taka (ADR 0008 amendment).
  BDT: { bands: BDT_BANDS, step: 50, minorPerMajor: 100 },
};

export function supportsDemoPricing(currency: string): boolean {
  return currency in BANDS_BY_CURRENCY;
}

export function syntheticPriceMinor(currency: string, categorySlug: string, seed: string): number {
  const table = BANDS_BY_CURRENCY[currency];
  if (!table) throw new Error(`No demo price bands for currency ${currency}`);
  const band = table.bands[categorySlug];
  if (!band) throw new Error(`No demo price band for category ${categorySlug}`);

  const steps = Math.floor((band.max - band.min) / table.step);
  const major = band.min + (stableHash(`price:${seed}`) % (steps + 1)) * table.step;
  return major * table.minorPerMajor;
}

/** Roughly 1 in 10 variants starts sold out, so out-of-stock states are exercised. */
export function syntheticStock(sku: string): number {
  const value = stableHash(`stock:${sku}`);
  return value % 10 === 0 ? 0 : 3 + (value % 22);
}

export const DEMO_LOW_STOCK_THRESHOLD = 3;
