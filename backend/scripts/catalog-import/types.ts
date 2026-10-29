/**
 * Shapes passed between the importer's stages. The source adapter produces `SourceRow` and
 * `SourceDetail` (what the dataset says); normalisation turns them into `NormalizedProduct`
 * (what CommerceCore will store). Nothing below `normalize.ts` knows which dataset a product
 * came from, so a second source is a second adapter, not a change to persistence.
 */

export type Gender = 'MEN' | 'WOMEN' | 'UNISEX';

/** One `styles.csv` row, validated but otherwise exactly as the source states it. */
export interface SourceRow {
  readonly externalId: string;
  readonly gender: string;
  readonly masterCategory: string;
  readonly subCategory: string;
  readonly articleType: string;
  readonly baseColour: string;
  readonly season: string;
  readonly year: number | null;
  readonly usage: string;
  readonly name: string;
}

/** The parts of `styles/<id>.json` the importer uses. Every field may be absent. */
export interface SourceDetail {
  readonly brand: string | null;
  /** Plain text, already stripped of the source's HTML. */
  readonly description: string | null;
  /** Size labels in source order, e.g. ["S", "M", "L"]. Empty when the source lists none. */
  readonly sizes: readonly string[];
  readonly ageGroup: string | null;
  /** Path of the original listing, relative to the retailer's site. Provenance only. */
  readonly landingPath: string | null;
}

export interface ProductImageInput {
  readonly objectKey: string;
  readonly altText: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteSize: number;
  readonly contentType: string;
  readonly sourceUrl: string;
  readonly attribution: string;
}

export interface NormalizedProduct {
  readonly provider: string;
  readonly externalId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly brand: string | null;
  readonly gender: Gender;
  readonly categorySlug: string;
  /** Display colour exactly as the source labels it ("Navy Blue"). */
  readonly colour: string;
  /** Empty: one variant with no size option. Never invented. */
  readonly sizes: readonly string[];
  readonly sourceUrl: string | null;
  /** Set only once the binary is safely in object storage. */
  readonly image: ProductImageInput | null;
  /** Storefront front-runner position (1 = first); written on create only. Absent: not featured. */
  readonly featuredRank?: number;
}
