import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

import { inspectImage } from '../scripts/catalog-import/image-info.js';
import {
  contentHash,
  htmlToText,
  mapGender,
  normalizeSizes,
  optionKey,
  productSlug,
  variantSku,
} from '../scripts/catalog-import/normalize.js';
import { normalizeProduct } from '../scripts/catalog-import/pipeline.js';
import {
  supportsDemoPricing,
  syntheticPriceMinor,
  syntheticStock,
} from '../scripts/catalog-import/pricing.js';
import {
  createSourceFiles,
  parseStyleDetail,
  parseStylesCsv,
} from '../scripts/catalog-import/source-fpi.js';
import { CATALOG_CATEGORIES, CATEGORY_CAPS, classify } from '../scripts/catalog-import/taxonomy.js';
import type { SourceRow } from '../scripts/catalog-import/types.js';
import { isZip, readZipEntry } from '../scripts/catalog-import/zip.js';
import { assertObjectKey, createFilesystemStorage } from '../src/lib/storage.js';

/** Unit tests for the catalog importer's pure stages; persistence is in tests/db. */

const HEADER =
  'id,gender,masterCategory,subCategory,articleType,baseColour,season,year,usage,productDisplayName';

function row(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    externalId: '1001',
    gender: 'Men',
    masterCategory: 'Apparel',
    subCategory: 'Topwear',
    articleType: 'Tshirts',
    baseColour: 'Black',
    season: 'Fall',
    year: 2012,
    usage: 'Casual',
    name: 'Roadster Men Black T-shirt',
    ...overrides,
  };
}

describe('parseStylesCsv', () => {
  it('treats an inch mark as text, so it cannot swallow the rows after it', () => {
    const BOM = String.fromCharCode(0xfeff);
    // Real rows 7491/7497: an RFC 4180 reader opened a quote here and lost ~2,000 rows.
    const { rows, invalid } = parseStylesCsv(
      `${BOM}${HEADER}\r\n` +
        `7491,Women,Apparel,Bottomwear,Shorts,Pink,Summer,2011,Sports,Nike Women's EM Tempo 3.5" Pink Short\r\n` +
        `7492,Men,Apparel,Topwear,Tshirts,Black,Summer,2011,Casual,Next Row\r\n`,
    );
    expect(invalid).toEqual([]);
    expect(rows.map((entry) => entry.name)).toEqual([
      `Nike Women's EM Tempo 3.5" Pink Short`,
      'Next Row',
    ]);
  });

  it('rejoins an unquoted comma in the display name instead of shifting columns', () => {
    const { rows, invalid } = parseStylesCsv(
      `${HEADER}\n15970,Men,Apparel,Topwear,Shirts,Navy Blue,Fall,2011,Casual,Turtle Check, Men Navy Shirt\n`,
    );
    expect(invalid).toEqual([]);
    expect(rows[0]?.name).toBe('Turtle Check, Men Navy Shirt');
    expect(rows[0]?.year).toBe(2011);
  });

  it('reports rows with missing required fields rather than guessing', () => {
    const { rows, invalid } = parseStylesCsv(
      `${HEADER}\nabc,Men,Apparel,Topwear,Shirts,Black,Fall,2011,Casual,Name\n2,Men,Apparel,Topwear,Shirts,,Fall,,Casual,Name\n`,
    );
    expect(rows).toEqual([]);
    expect(invalid.map((entry) => entry.line)).toEqual([2, 3]);
    expect(invalid[1]?.issues).toContain('baseColour');
  });

  it('refuses a file whose header is not the expected one', () => {
    expect(() => parseStylesCsv('id,name\n1,x\n')).toThrow(/Unexpected styles.csv header/);
  });
});

describe('parseStyleDetail', () => {
  it('extracts brand, plain-text description, active sizes and age group', () => {
    const detail = parseStyleDetail({
      data: {
        brandName: ' Roadster ',
        ageGroup: 'Adults-Men',
        landingPageUrl: 'Tshirts/Roadster/x/1001/buy',
        productDescriptors: {
          description: { value: '<p>Soft <b>cotton</b> &amp; jersey<br />Crew neck</p>' },
          materials_care_desc: { value: '<ul><li>Machine wash</li></ul>' },
          size_chart: { value: '<table>ignored</table>' },
        },
        styleOptions: [
          { name: 'Size', value: 'S', active: true },
          { name: 'Size', value: 'M', active: true },
          { name: 'Size', value: 'm', active: true },
          { name: 'Size', value: 'XXL', active: false },
          { name: 'Colour', value: 'Black' },
        ],
      },
    });

    expect(detail).toEqual({
      brand: 'Roadster',
      description: 'Soft cotton & jersey\nCrew neck\n\n• Machine wash',
      sizes: ['S', 'M'],
      ageGroup: 'Adults-Men',
      landingPath: 'Tshirts/Roadster/x/1001/buy',
    });
  });

  it('returns nulls, not invented values, when fields are absent', () => {
    expect(parseStyleDetail({ data: {} })).toEqual({
      brand: null,
      description: null,
      sizes: [],
      ageGroup: null,
      landingPath: null,
    });
  });

  it('rejects a document without a data object', () => {
    expect(() => parseStyleDetail({ notification: {} })).toThrow(/Unexpected style JSON/);
  });
});

describe('normalisation helpers', () => {
  it('builds stable, constraint-safe slugs with the source id', () => {
    expect(productSlug('Roadster Men Black T-shirt', '1001')).toBe(
      'roadster-men-black-t-shirt-1001',
    );
    expect(productSlug('Café & Co.', '7')).toBe('cafe-and-co-7');
    expect(productSlug('!!!', '9')).toBe('product-9');
    expect(productSlug('a '.repeat(100), '5')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('maps only adult lines to a gender', () => {
    expect(mapGender('Men')).toBe('MEN');
    expect(mapGender('Women')).toBe('WOMEN');
    expect(mapGender('Unisex')).toBe('UNISEX');
    expect(mapGender('Boys')).toBeNull();
  });

  it('drops a lone "one size" rather than inventing a size dimension', () => {
    expect(normalizeSizes(['Onesize'])).toEqual([]);
    expect(normalizeSizes([' UK 8 ', 'UK 9'])).toEqual(['UK 8', 'UK 9']);
  });

  it('produces canonical option keys and SKUs', () => {
    expect(optionKey('Navy Blue', 'UK 8')).toBe('color:navy-blue|size:uk-8');
    expect(optionKey('Black', null)).toBe('color:black');
    expect(variantSku('FPI', '1001', 'UK 8')).toBe('FPI-1001-UK8');
    expect(variantSku('FPI', '1001', null)).toBe('FPI-1001');
  });

  it('strips markup completely, including scripts', () => {
    expect(htmlToText('<script>alert(1)</script><p>Hi&nbsp;there &#39;you&#39;</p>')).toBe(
      "Hi there 'you'",
    );
  });

  it('changes the content hash when any descriptive field changes', () => {
    const base = { name: 'A', description: null, brand: 'B', gender: 'MEN' as const };
    expect(contentHash(base)).toBe(contentHash({ ...base }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, brand: 'C' }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, description: '' }));
  });
});

describe('classify', () => {
  it('includes on-brief items in their own source colour', () => {
    expect(classify(row())).toEqual({ included: true, categorySlug: 't-shirts' });
  });

  it('excludes off-palette colours instead of relabelling them', () => {
    expect(classify(row({ baseColour: 'Yellow' }))).toEqual({
      included: false,
      reason: 'off_palette_colour',
    });
  });

  it('excludes kids, ethnic wear, sportswear and off-brief types', () => {
    expect(classify(row({ gender: 'Boys' }))).toMatchObject({ reason: 'not_adult_line' });
    expect(classify(row({ usage: 'Ethnic' }))).toMatchObject({ reason: 'ethnic_wear' });
    expect(classify(row({ usage: 'Sports' }))).toMatchObject({ reason: 'sportswear' });
    expect(classify(row({ articleType: 'Watches' }))).toMatchObject({ reason: 'off_brief_type' });
  });

  it('routes a shoe named as a boot to boots', () => {
    expect(
      classify(
        row({
          masterCategory: 'Footwear',
          articleType: 'Casual Shoes',
          baseColour: 'Brown',
          name: 'Woodland Men Brown Boots',
        }),
      ),
    ).toEqual({ included: true, categorySlug: 'boots' });
  });

  it('only routes to categories that exist and are capped', () => {
    const slugs = new Set(CATALOG_CATEGORIES.map((category) => category.slug));
    for (const slug of Object.keys(CATEGORY_CAPS)) expect(slugs.has(slug)).toBe(true);
  });
});

describe('normalizeProduct', () => {
  it('maps a source row and detail without adding facts', () => {
    const product = normalizeProduct(row(), 't-shirts', {
      brand: null,
      description: null,
      sizes: ['S', 'M'],
      ageGroup: 'Adults-Men',
      landingPath: 'Tshirts/x/1001/buy',
    });
    expect(product).toMatchObject({
      provider: 'fashion-product-images',
      externalId: '1001',
      slug: 'roadster-men-black-t-shirt-1001',
      brand: null,
      gender: 'MEN',
      colour: 'Black',
      sizes: ['S', 'M'],
      sourceUrl: 'https://www.myntra.com/Tshirts/x/1001/buy',
      image: null,
    });
  });
});

describe('synthetic demo pricing', () => {
  it('is deterministic, inside the BDT band, on ৳50 steps, in poisha', () => {
    const price = syntheticPriceMinor('BDT', 'jackets', 'fashion-product-images:1001');
    expect(syntheticPriceMinor('BDT', 'jackets', 'fashion-product-images:1001')).toBe(price);
    expect(price).toBeGreaterThanOrEqual(5_500_00);
    expect(price).toBeLessThanOrEqual(14_000_00);
    expect(price % (50 * 100)).toBe(0);
  });

  it('refuses currencies without a defined band instead of reusing BDT numbers', () => {
    expect(supportsDemoPricing('BDT')).toBe(true);
    expect(supportsDemoPricing('USD')).toBe(false);
    expect(() => syntheticPriceMinor('USD', 'jackets', 'x')).toThrow(/No demo price bands/);
  });

  it('produces non-negative, stable stock with some sold-out variants', () => {
    const values = Array.from({ length: 200 }, (_, index) => syntheticStock(`FPI-${index}`));
    expect(values.every((value) => value >= 0 && value <= 24)).toBe(true);
    expect(values).toContain(0);
    expect(syntheticStock('FPI-1')).toBe(syntheticStock('FPI-1'));
  });
});

describe('inspectImage', () => {
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(33);
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(bytes, 0);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  };

  const jpeg = (width: number, height: number) =>
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      0x03,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);

  it('reads type and dimensions from the bytes', () => {
    expect(inspectImage(png(1200, 1600))).toEqual({
      ok: true,
      info: { contentType: 'image/png', widthPx: 1200, heightPx: 1600, byteSize: 33 },
    });
    expect(inspectImage(jpeg(1080, 1440))).toMatchObject({
      ok: true,
      info: { contentType: 'image/jpeg', widthPx: 1080, heightPx: 1440 },
    });
  });

  it('rejects thumbnails, unknown formats and an HTML error page saved as .jpg', () => {
    expect(inspectImage(png(60, 80))).toEqual({ ok: false, reason: 'too_small' });
    expect(inspectImage(Buffer.from('<!DOCTYPE html><html>Not found</html>'))).toEqual({
      ok: false,
      reason: 'unrecognised_format',
    });
  });
});

// A real deflated archive (Python zipfile) with two entries.
const zipFixture = Buffer.from(
  'UEsDBBQAAAAIAPVtW12HcuC0CwAAAAkAAAAJAAAAbm90ZXMudHh0y0zPyy9KVchNBQBQSwMEFAAAAAgA9W1bXZgKYuYZAAAAPAAAAAoAAABzdHlsZXMuY3N2y0zRyUvMTeUy1HHKSUzOVghJTeXKJFIMAFBLAQIUABQAAAAIAPVtW12HcuC0CwAAAAkAAAAJAAAAAAAAAAAAAACAAQAAAABub3Rlcy50eHRQSwECFAAUAAAACAD1bVtdmApi5hkAAAA8AAAACgAAAAAAAAAAAAAAgAEyAAAAc3R5bGVzLmNzdlBLBQYAAAAAAgACAG8AAABzAAAAAAA=',
  'base64',
);

describe('readZipEntry', () => {
  const archive = zipFixture;

  it('extracts the named entry', () => {
    expect(isZip(archive)).toBe(true);
    expect(readZipEntry(archive, (name) => name === 'styles.csv').toString('utf8')).toBe(
      'id,name\n1,Black Tee\n'.repeat(3),
    );
  });

  it('fails clearly when the entry is missing', () => {
    expect(() => readZipEntry(archive, (name) => name === 'nope.csv')).toThrow(/does not contain/);
  });

  it('reads sizes from the ZIP64 extra field, as Kaggle serves styles.csv', () => {
    // Same layout as the real file: central sizes are 0xFFFFFFFF, real values in extra 0x0001.
    const content = Buffer.from('id,name\n1,Black Tee\n');
    const data = deflateRawSync(content);
    const name = Buffer.from('styles.csv');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);

    const zip64 = Buffer.alloc(20);
    zip64.writeUInt16LE(0x0001, 0);
    zip64.writeUInt16LE(16, 2);
    zip64.writeBigUInt64LE(BigInt(content.length), 4);
    zip64.writeBigUInt64LE(BigInt(data.length), 12);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(45, 4);
    central.writeUInt16LE(45, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0xffffffff, 20);
    central.writeUInt32LE(0xffffffff, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(zip64.length, 30);
    central.writeUInt32LE(0, 42);

    const centralOffset = local.length + name.length + data.length;
    const centralSize = central.length + name.length + zip64.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);

    const zip = Buffer.concat([local, name, data, central, name, zip64, eocd]);
    expect(readZipEntry(zip, (entry) => entry === 'styles.csv').toString('utf8')).toBe(
      'id,name\n1,Black Tee\n',
    );
  });
});

describe('cached source files', () => {
  it('unwraps a file Kaggle served inside a ZIP, and needs no token for cached files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-source-'));
    try {
      const images = path.join(dir, 'fashion-product-images', 'images');
      await mkdir(images, { recursive: true });
      // Reuses the two-entry fixture; the first entry stands in for the wrapped image.
      await writeFile(path.join(images, '5.jpg'), zipFixture);

      const source = createSourceFiles(dir, null);
      const image = await source.image('5');

      expect(image).toEqual({ bytes: Buffer.from('ignore me'), cached: true });
      expect(await source.image('6')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('filesystem storage', () => {
  let root = '';

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('writes by key, idempotently, and reports existence', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cc-media-'));
    const storage = createFilesystemStorage(root);

    expect(await storage.exists('catalog/x/1/1.jpg')).toBe(false);
    await storage.put('catalog/x/1/1.jpg', Buffer.from('one'), 'image/jpeg');
    await storage.put('catalog/x/1/1.jpg', Buffer.from('two'), 'image/jpeg');

    expect(await storage.exists('catalog/x/1/1.jpg')).toBe(true);
    expect(await readFile(path.join(root, 'catalog', 'x', '1', '1.jpg'), 'utf8')).toBe('two');
  });

  it('rejects keys that could escape the media root', () => {
    for (const key of ['../etc/passwd', '/abs/path', 'a/../../b', 'Upper/Case', 'a\\b', '']) {
      expect(() => assertObjectKey(key)).toThrow(/Invalid object key/);
    }
  });
});
