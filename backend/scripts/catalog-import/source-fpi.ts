import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { KaggleNotFoundError, type KaggleClient } from './kaggle.js';
import { htmlToText } from './normalize.js';
import type { SourceDetail, SourceRow } from './types.js';
import { isZip, readZipEntry } from './zip.js';

/**
 * Source adapter: "Fashion Product Images Dataset" by Param Aggarwal on Kaggle
 * (`paramaggarwal/fashion-product-images-dataset`). Licence on Kaggle: MIT, as labelled by the
 * uploader; the imagery originates from Myntra. Development / labelled-demo use only — see
 * docs/fashion-catalog-integration-plan.md §3.
 *
 * Acquisition and parsing only. Files are cached under `<dataDir>/fashion-product-images/` and a
 * cached file is never downloaded twice, so a rerun or a manual download costs nothing.
 *
 * Field facts verified against real files on 2026-10-27:
 *  - styles.csv: id, gender, masterCategory, subCategory, articleType, baseColour, season, year,
 *    usage, productDisplayName (44,446 rows).
 *  - styles/<id>.json → `data`: brandName, productDescriptors.{description,...}.value (HTML),
 *    styleOptions[] {name: "Size", value, active}, ageGroup ("Adults-Men", "Kids-Girls"),
 *    landingPageUrl, price/discountedPrice (no currency field — unused, see ADR 0008).
 *  - images/<id>.jpg: one JPEG per style.
 */
export const PROVIDER = 'fashion-product-images';
export const KAGGLE_DATASET = 'paramaggarwal/fashion-product-images-dataset';
export const DATASET_URL = `https://www.kaggle.com/datasets/${KAGGLE_DATASET}`;
export const IMAGE_ATTRIBUTION =
  'Fashion Product Images Dataset by Param Aggarwal (Kaggle, MIT-labelled); original imagery from Myntra. Development/demo use only.';

const REMOTE = {
  styles: 'fashion-dataset/styles.csv',
  detail: (id: string) => `fashion-dataset/styles/${id}.json`,
  image: (id: string) => `fashion-dataset/images/${id}.jpg`,
};

const HEADER = [
  'id',
  'gender',
  'masterCategory',
  'subCategory',
  'articleType',
  'baseColour',
  'season',
  'year',
  'usage',
  'productDisplayName',
] as const;

const rowSchema = z.object({
  externalId: z.string().regex(/^\d{1,10}$/, 'id must be numeric'),
  gender: z.string().trim().min(1),
  masterCategory: z.string().trim().min(1),
  subCategory: z.string().trim().min(1),
  articleType: z.string().trim().min(1),
  baseColour: z.string().trim().min(1, 'baseColour is missing'),
  season: z.string().trim(),
  year: z.number().int().nullable(),
  usage: z.string().trim(),
  name: z.string().trim().min(1, 'productDisplayName is missing').max(200),
});

export interface InvalidRow {
  readonly line: number;
  readonly externalId: string | null;
  readonly issues: string;
}

/**
 * `styles.csv` is NOT RFC 4180: nothing is quoted, and names contain literal inch marks
 * (`Tempo 3.5" Pink Short`). A quote-aware reader treats that `"` as an opening quote and
 * silently swallows the following ~2,000 rows into one field (observed 2026-10-27), so this
 * splits on line breaks and commas with no quote handling.
 */
function splitUnquotedCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return input
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(','));
}

/** Validates every row; an invalid row is reported, never guessed into shape. */
export function parseStylesCsv(text: string): { rows: SourceRow[]; invalid: InvalidRow[] } {
  const [header, ...records] = splitUnquotedCsv(text);
  if (!header || HEADER.some((name, index) => header[index]?.trim() !== name)) {
    throw new Error(`Unexpected styles.csv header: ${JSON.stringify(header)}`);
  }

  const rows: SourceRow[] = [];
  const invalid: InvalidRow[] = [];

  records.forEach((cells, index) => {
    // An unquoted comma inside the display name splits it across the trailing cells.
    const fields =
      cells.length > HEADER.length
        ? [...cells.slice(0, HEADER.length - 1), cells.slice(HEADER.length - 1).join(',')]
        : cells;
    const yearText = fields[7]?.trim() ?? '';
    const candidate = {
      externalId: fields[0]?.trim() ?? '',
      gender: fields[1] ?? '',
      masterCategory: fields[2] ?? '',
      subCategory: fields[3] ?? '',
      articleType: fields[4] ?? '',
      baseColour: fields[5] ?? '',
      season: fields[6] ?? '',
      year: /^\d{4}(\.0)?$/.test(yearText) ? Number.parseInt(yearText, 10) : null,
      usage: fields[8] ?? '',
      name: fields[9] ?? '',
    };

    const parsed = rowSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      invalid.push({
        line: index + 2,
        externalId: candidate.externalId || null,
        issues: parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      });
    }
  });

  return { rows, invalid };
}

const descriptorSchema = z.object({ value: z.string().optional() }).passthrough();
const detailSchema = z.object({
  data: z
    .object({
      brandName: z.string().nullish(),
      ageGroup: z.string().nullish(),
      landingPageUrl: z.string().nullish(),
      productDescriptors: z.record(z.string(), descriptorSchema).nullish(),
      styleOptions: z
        .array(
          z
            .object({
              name: z.string().nullish(),
              value: z.string().nullish(),
              active: z.boolean().nullish(),
            })
            .passthrough(),
        )
        .nullish(),
    })
    .passthrough(),
});

/** Descriptor blocks worth showing, in display order. Others (e.g. size charts) are skipped. */
const DESCRIPTOR_ORDER = ['description', 'style_note', 'materials_care_desc', 'size_fit_desc'];

export function parseStyleDetail(json: unknown): SourceDetail {
  const parsed = detailSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Unexpected style JSON shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const data = parsed.data.data;

  const blocks = DESCRIPTOR_ORDER.map((key) => data.productDescriptors?.[key]?.value)
    .filter((value): value is string => typeof value === 'string')
    .map(htmlToText)
    .filter((text) => text.length > 0);
  const description = blocks.length > 0 ? blocks.join('\n\n').slice(0, 5_000) : null;

  const sizes: string[] = [];
  for (const option of data.styleOptions ?? []) {
    const value = option.value?.trim();
    if (option.name?.trim().toLowerCase() !== 'size' || !value || option.active === false) continue;
    if (!sizes.some((existing) => existing.toLowerCase() === value.toLowerCase()))
      sizes.push(value);
  }

  const brand = data.brandName?.trim();
  return {
    brand: brand ? brand : null,
    description,
    sizes,
    ageGroup: data.ageGroup?.trim() || null,
    landingPath: data.landingPageUrl?.trim() || null,
  };
}

// --- cached acquisition ---------------------------------------------------------------

export interface SourceFiles {
  readonly root: string;
  stylesCsv(): Promise<string>;
  /** `null` when the dataset has no such file. */
  detail(id: string): Promise<{ detail: SourceDetail; cached: boolean } | null>;
  image(id: string): Promise<{ bytes: Buffer; cached: boolean } | null>;
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    if (!(await stat(file)).isFile()) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

/**
 * Kaggle wraps larger files (observed: images over ~900 KB) in a single-entry ZIP even when one
 * file is requested. The cache keeps exactly what was served; it is unwrapped on read.
 */
function unwrap(bytes: Buffer): Buffer {
  return isZip(bytes) ? readZipEntry(bytes, () => true) : bytes;
}

/**
 * Local cache first, Kaggle second. `kaggle` is null when no token is configured; then only
 * files already present (e.g. from a manual download) can be used.
 */
export function createSourceFiles(dataDir: string, kaggle: KaggleClient | null): SourceFiles {
  const root = path.resolve(dataDir, PROVIDER);

  async function fetchCached(
    local: string,
    remote: string,
  ): Promise<{ bytes: Buffer; cached: boolean } | null> {
    const existing = await readIfPresent(local);
    if (existing) return { bytes: existing, cached: true };
    if (!kaggle) return null;
    try {
      const bytes = await kaggle.downloadFile(remote);
      await writeAtomic(local, bytes);
      return { bytes, cached: false };
    } catch (error) {
      if (error instanceof KaggleNotFoundError) return null;
      throw error;
    }
  }

  return {
    root,
    async stylesCsv() {
      // A manually extracted archive puts the plain CSV here.
      const manual = await readIfPresent(path.join(root, 'styles.csv'));
      if (manual) return manual.toString('utf8');

      // What Kaggle serves for this path is a ZIP around the CSV, hence the neutral name.
      const result = await fetchCached(path.join(root, 'styles.download'), REMOTE.styles);
      if (!result) {
        throw new Error(
          `styles.csv is not cached under ${root} and no Kaggle token is configured (KAGGLE_USERNAME / KAGGLE_KEY).`,
        );
      }
      const csv = isZip(result.bytes)
        ? readZipEntry(result.bytes, (name) => name.endsWith('styles.csv'))
        : result.bytes;
      return csv.toString('utf8');
    },
    async detail(id) {
      const result = await fetchCached(path.join(root, 'styles', `${id}.json`), REMOTE.detail(id));
      if (!result) return null;
      return {
        detail: parseStyleDetail(JSON.parse(unwrap(result.bytes).toString('utf8'))),
        cached: result.cached,
      };
    },
    async image(id) {
      const result = await fetchCached(path.join(root, 'images', `${id}.jpg`), REMOTE.image(id));
      return result ? { bytes: unwrap(result.bytes), cached: result.cached } : null;
    },
  };
}
