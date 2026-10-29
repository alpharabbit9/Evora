import { describe, expect, it } from 'vitest';

import { searchTerms } from '../src/modules/catalog/catalog.query.js';
import { productFacetsQuery, productListQuery } from '../src/modules/catalog/catalog.schemas.js';
import { compareSizes, readOption } from '../src/modules/catalog/sizes.js';
import { availabilityOf } from '../src/modules/catalog/products.service.js';
import { addCartItemBody, updateCartItemBody } from '../src/modules/cart/cart.schemas.js';
import { hashGuestToken, readGuestTokenHash } from '../src/modules/cart/guest-token.js';
import type { Request } from 'express';

/**
 * Pure rules of the public catalog and cart: query validation, size ordering, availability
 * and the guest token format. The database behaviour of the same modules is covered by
 * `tests/integration/catalog.test.ts` and `tests/integration/cart.test.ts`.
 */

describe('productListQuery', () => {
  it('applies defaults and parses comma lists', () => {
    const parsed = productListQuery.parse({ color: 'Black, Navy Blue,Black', brand: 'Puma' });

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(24);
    expect(parsed.sort).toBeUndefined();
    expect(parsed.color).toEqual(['Black', 'Navy Blue']);
    expect(parsed.brand).toEqual(['Puma']);
  });

  it('upper-cases sizes, because the source spells UK9 and uk9', () => {
    expect(productListQuery.parse({ size: 'uk9,UK9,m' }).size).toEqual(['UK9', 'M']);
  });

  it('turns inStock into a boolean and refuses anything but true/false', () => {
    expect(productListQuery.parse({ inStock: 'true' }).inStock).toBe(true);
    expect(productListQuery.parse({ inStock: 'false' }).inStock).toBe(false);
    expect(productListQuery.safeParse({ inStock: '1' }).success).toBe(false);
  });

  it('rejects unknown keys instead of silently ignoring a misspelt filter', () => {
    expect(productListQuery.safeParse({ colour: 'Black' }).success).toBe(false);
  });

  it('rejects a sort that is not allow-listed', () => {
    expect(productListQuery.safeParse({ sort: 'price_minor; DROP TABLE products' }).success).toBe(
      false,
    );
    expect(productListQuery.safeParse({ sort: 'popularity' }).success).toBe(false);
  });

  it('rejects a reversed price range, negative money and oversized pages', () => {
    expect(productListQuery.safeParse({ minPrice: '500', maxPrice: '100' }).success).toBe(false);
    expect(productListQuery.safeParse({ minPrice: '-1' }).success).toBe(false);
    expect(productListQuery.safeParse({ minPrice: '1.5' }).success).toBe(false);
    expect(productListQuery.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('caps list sizes and value lengths', () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => `c${String(index)}`).join(',');
    expect(productListQuery.safeParse({ color: tooMany }).success).toBe(false);
    expect(productListQuery.safeParse({ brand: 'x'.repeat(81) }).success).toBe(false);
    expect(productListQuery.safeParse({ color: ',,,' }).success).toBe(false);
  });

  it('accepts only slugs for category and the three genders', () => {
    expect(productListQuery.safeParse({ category: 'Boots' }).success).toBe(false);
    expect(productListQuery.safeParse({ category: '../admin' }).success).toBe(false);
    expect(productListQuery.safeParse({ gender: 'kids' }).success).toBe(false);
    expect(productListQuery.parse({ category: 'boots', gender: 'women' })).toMatchObject({
      category: 'boots',
      gender: 'women',
    });
  });

  it('bounds the search text', () => {
    expect(productListQuery.safeParse({ q: '   ' }).success).toBe(false);
    expect(productListQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(productListQuery.parse({ q: '  black boots ' }).q).toBe('black boots');
  });
});

describe('productFacetsQuery', () => {
  it('takes only the scope filters', () => {
    expect(productFacetsQuery.safeParse({ gender: 'men', q: 'boots' }).success).toBe(true);
    expect(productFacetsQuery.safeParse({ color: 'Black' }).success).toBe(false);
  });
});

describe('searchTerms', () => {
  it('lower-cases, de-duplicates and caps the words of a search', () => {
    expect(searchTerms('Black  BOOTS black')).toEqual(['black', 'boots']);
    expect(searchTerms('a b c d e f g')).toHaveLength(5);
  });
});

describe('compareSizes', () => {
  it('orders letter sizes by fit, not alphabetically', () => {
    expect(['XL', 'S', 'XXL', 'M', 'XS', 'L'].sort(compareSizes)).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
      'XXL',
    ]);
  });

  it('orders numbers numerically and groups size systems', () => {
    expect(['10', '9', '32', '28'].sort(compareSizes)).toEqual(['9', '10', '28', '32']);
    expect(['US8', 'UK10', 'EURO42', 'UK8', 'M', '30'].sort(compareSizes)).toEqual([
      'M',
      '30',
      'UK8',
      'UK10',
      'EURO42',
      'US8',
    ]);
  });

  it('keeps unknown labels, last', () => {
    expect(['Freesize', 'S'].sort(compareSizes)).toEqual(['S', 'Freesize']);
  });
});

describe('readOption', () => {
  it('reads string options and ignores anything else', () => {
    expect(readOption({ color: 'Black', size: 'M' }, 'size')).toBe('M');
    expect(readOption({ color: 'Black' }, 'size')).toBeNull();
    expect(readOption({ size: 42 }, 'size')).toBeNull();
    expect(readOption({ size: '  ' }, 'size')).toBeNull();
    expect(readOption(null, 'color')).toBeNull();
    expect(readOption(['Black'], 'color')).toBeNull();
  });
});

describe('availabilityOf', () => {
  it('reports a state, never the stock number', () => {
    expect(availabilityOf(0, 3)).toBe('out_of_stock');
    expect(availabilityOf(2, 3)).toBe('low_stock');
    expect(availabilityOf(3, 3)).toBe('low_stock');
    expect(availabilityOf(4, 3)).toBe('in_stock');
    expect(availabilityOf(5, 0)).toBe('in_stock');
  });
});

describe('cart bodies', () => {
  it('accept a variant id and a quantity, defaulting the quantity to 1', () => {
    expect(addCartItemBody.parse({ variantId: 'cmvqgmrx20hxrmotqvpzhjk5k' })).toEqual({
      variantId: 'cmvqgmrx20hxrmotqvpzhjk5k',
      quantity: 1,
    });
  });

  it('refuse a client price, total or stock rather than ignore it', () => {
    for (const extra of [{ priceMinor: 1 }, { unitPriceMinor: 1 }, { stockQuantity: 99 }]) {
      expect(
        addCartItemBody.safeParse({ variantId: 'cmvqgmrx20hxrmotqvpzhjk5k', ...extra }).success,
      ).toBe(false);
    }
  });

  it('bound the quantity to 1..10', () => {
    expect(updateCartItemBody.safeParse({ quantity: 0 }).success).toBe(false);
    expect(updateCartItemBody.safeParse({ quantity: 11 }).success).toBe(false);
    expect(updateCartItemBody.safeParse({ quantity: 2.5 }).success).toBe(false);
    expect(updateCartItemBody.parse({ quantity: 10 })).toEqual({ quantity: 10 });
  });
});

describe('guest cart token', () => {
  const requestWith = (value: unknown) =>
    ({ cookies: { 'commercecore.cart': value } }) as unknown as Request;

  it('hashes a well-formed token and ignores anything else', () => {
    const token = 'A'.repeat(43);

    expect(readGuestTokenHash(requestWith(token))).toBe(hashGuestToken(token));
    expect(readGuestTokenHash(requestWith('short'))).toBeUndefined();
    expect(readGuestTokenHash(requestWith(`${'A'.repeat(42)}!`))).toBeUndefined();
    expect(readGuestTokenHash(requestWith(['A'.repeat(43)]))).toBeUndefined();
    expect(readGuestTokenHash({ cookies: {} } as unknown as Request)).toBeUndefined();
  });

  it('stores a hash, not the token', () => {
    const token = 'B'.repeat(43);
    expect(hashGuestToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(token)).not.toContain(token);
  });
});
