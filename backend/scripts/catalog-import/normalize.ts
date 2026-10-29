import { createHash } from 'node:crypto';

import type { Gender } from './types.js';

/**
 * Pure normalisation helpers. Each one only reshapes what the source said; none of them adds a
 * fact the source did not state.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  deg: '°',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Source descriptions are retailer HTML. Stored as plain text: block boundaries become line
 * breaks, every tag is dropped, so nothing from the source is ever rendered as markup.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Lowercase ASCII kebab-case; satisfies the `*_slug_format_check` constraints. */
export function kebab(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `<name>-<externalId>`. The id suffix makes the slug unique without a lookup, and stable across
 * reruns, so a URL never changes because another product with the same name was imported.
 */
export function productSlug(name: string, externalId: string): string {
  let base = kebab(name);
  if (base.length > 80) base = base.slice(0, 80).replace(/-[^-]*$/, '');
  return base ? `${base}-${externalId}` : `product-${externalId}`;
}

const GENDERS: Record<string, Gender> = { men: 'MEN', women: 'WOMEN', unisex: 'UNISEX' };

/** Adult lines only; Boys/Girls map to nothing because the store has no kids range. */
export function mapGender(source: string): Gender | null {
  return GENDERS[source.trim().toLowerCase()] ?? null;
}

/** A single "one size" value is not a real size dimension. */
const ONE_SIZE = /^(one ?size|onesize|free ?size|os|na|std|standard)$/i;

export function normalizeSizes(sizes: readonly string[]): string[] {
  const cleaned = sizes.map((size) => size.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cleaned.length === 1 && ONE_SIZE.test(cleaned[0] ?? '')) return [];
  return cleaned.filter((size) => !ONE_SIZE.test(size));
}

/** Canonical option key, matching the seed's `color:black|size:m` format. */
export function optionKey(colour: string, size: string | null): string {
  const parts = [`color:${kebab(colour) || 'unknown'}`];
  if (size !== null) parts.push(`size:${kebab(size) || 'unknown'}`);
  return parts.join('|');
}

/** Stable SKU: provider prefix + source id (+ size). Upper-case alphanumerics only. */
export function variantSku(prefix: string, externalId: string, size: string | null): string {
  const sizePart = size === null ? '' : `-${size.toUpperCase().replace(/[^A-Z0-9]+/g, '')}`;
  return `${prefix}-${externalId}${sizePart === '-' ? '-X' : sizePart}`;
}

/** Fields an admin may edit; the hash detects that edit on the next import run (ADR 0011). */
export interface DescriptiveFields {
  readonly name: string;
  readonly description: string | null;
  readonly brand: string | null;
  readonly gender: Gender | null;
}

export function contentHash(fields: DescriptiveFields): string {
  return createHash('sha256')
    .update(JSON.stringify([fields.name, fields.description, fields.brand, fields.gender]))
    .digest('hex');
}

/** Deterministic unsigned 32-bit number from text, for synthetic-but-stable demo values. */
export function stableHash(text: string): number {
  return createHash('sha256').update(text).digest().readUInt32BE(0);
}
