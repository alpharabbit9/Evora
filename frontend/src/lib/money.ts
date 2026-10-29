/**
 * Formats an integer minor-unit amount for display (ADR 0008). Display only: no arithmetic
 * on prices happens in the browser — totals come from the API.
 *
 * `narrowSymbol` gives `৳` for BDT. Whole amounts drop the decimals (৳2,850), which is how
 * the catalog's prices read; anything with poisha keeps two places.
 *
 * Render prices in the body face, never `font-display`: the demo display font watermarks
 * digits and symbols.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, fractionDigits: 0 | 2): Intl.NumberFormat {
  const key = `${currency}:${String(fractionDigits)}`;
  let formatter = formatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, formatter);
  }

  return formatter;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const whole = amountMinor % 100 === 0;
  return formatterFor(currency, whole ? 0 : 2).format(amountMinor / 100);
}

/** `৳2,850` or `৳2,850 – ৳3,400` when variants are priced differently. */
export function formatPriceRange(minMinor: number, maxMinor: number, currency: string): string {
  return minMinor === maxMinor
    ? formatMoney(minMinor, currency)
    : `${formatMoney(minMinor, currency)} – ${formatMoney(maxMinor, currency)}`;
}
