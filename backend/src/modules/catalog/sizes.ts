/**
 * Display order for size labels. Sizes are free text from the source (`S`, `32`, `UK8`,
 * `EURO42`, `US10`), and alphabetical order puts `XL` before `XS` and `10` before `9`, which
 * reads as broken on a size picker.
 *
 * Groups come first (letter sizes, plain numbers, then UK/EURO/US), then the value within the
 * group. Anything unrecognised sorts last, alphabetically, rather than being dropped.
 */
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '4XL'];

const SYSTEM_PREFIXES = ['UK', 'EURO', 'EU', 'US'];

function sizeRank(size: string): [number, number, string] {
  const label = size.trim().toUpperCase();

  const letter = LETTER_SIZES.indexOf(label);
  if (letter !== -1) {
    return [0, letter, label];
  }

  if (/^\d+(\.\d+)?$/.test(label)) {
    return [1, Number(label), label];
  }

  for (const [index, prefix] of SYSTEM_PREFIXES.entries()) {
    const match = new RegExp(`^${prefix}\\s*(\\d+(?:\\.\\d+)?)$`).exec(label);
    if (match?.[1]) {
      return [2 + index, Number(match[1]), label];
    }
  }

  return [99, 0, label];
}

export function compareSizes(a: string, b: string): number {
  const [groupA, valueA, labelA] = sizeRank(a);
  const [groupB, valueB, labelB] = sizeRank(b);

  return groupA - groupB || valueA - valueB || labelA.localeCompare(labelB);
}

/** `options` is untyped JSON in the schema; read only string values out of it. */
export function readOption(options: unknown, key: 'color' | 'size'): string | null {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return null;
  }

  const value = (options as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
