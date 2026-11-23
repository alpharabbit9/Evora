/**
 * The pieces on the home page's "Recent Arrivals" clothes rail (ADR 0027). A curated, hand-kept
 * list: each garment has a studio photo from the side and from the front, cut out of its
 * backdrop by `scripts/recent-arrivals/make_cutouts.py` into
 * `public/images/homepage/recent-arrivals/<slug>-{side,front}.webp`.
 *
 * Each piece is also a catalog product, imported by `npm run catalog:rail` from
 * `backend/scripts/catalog-import/curated/rail.json` (synthetic demo data), and links to its
 * product page. Price, sizes and stock live there, on the server; this list holds only what
 * the rail draws. `backend/tests/rail.test.ts` checks that every `productSlug` here is one the
 * importer creates.
 *
 * To add a piece: add its two photos to `public/images/homepage/Recent Arrivals/` and
 * `GARMENTS` in the script, re-run it, add the product to `rail.json` and re-run the importer,
 * then add an entry below.
 */

export interface ArrivalCategory {
  /** A catalog category slug (`backend/scripts/catalog-import/taxonomy.ts`). */
  readonly slug: string;
  readonly name: string;
}

export interface ArrivalPiece {
  /** Names the cut-out files. */
  readonly slug: string;
  /** The catalog product's slug (`/products/<productSlug>`). */
  readonly productSlug: string;
  readonly name: string;
  readonly colour: string;
  /** The garment's own colour, for the swatch beside its name. */
  readonly tone: string;
  /** How long it hangs, relative to a jacket (1): a tee hangs shorter than a hoodie. */
  readonly length: number;
  readonly category: ArrivalCategory;
}

const JACKETS: ArrivalCategory = { slug: 'jackets', name: 'Jackets' };
const HOODIES: ArrivalCategory = { slug: 'hoodies', name: 'Hoodies' };
const KNITWEAR: ArrivalCategory = { slug: 'knitwear', name: 'Knitwear' };
const TEES: ArrivalCategory = { slug: 't-shirts', name: 'T-Shirts & Tops' };

/** Newest first. */
export const ARRIVAL_PIECES: readonly ArrivalPiece[] = [
  {
    slug: 'forest-green-bomber',
    productSlug: 'forest-bomber-rl001',
    name: 'Forest Bomber',
    colour: 'Forest green',
    tone: '#2f5a3c',
    length: 1,
    category: JACKETS,
  },
  {
    slug: 'varsity-jacket',
    productSlug: 'varsity-jacket-rl002',
    name: 'Varsity Jacket',
    colour: 'Burgundy / black',
    tone: '#7a1f33',
    length: 1.02,
    category: JACKETS,
  },
  {
    slug: 'mustard-hoodie',
    productSlug: 'fleece-hoodie-rl003',
    name: 'Fleece Hoodie',
    colour: 'Mustard',
    tone: '#e0a21a',
    length: 1.06,
    category: HOODIES,
  },
  {
    slug: 'black-leather-jacket',
    productSlug: 'leather-racer-jacket-rl004',
    name: 'Leather Racer Jacket',
    colour: 'Black',
    tone: '#3a3a3c',
    length: 0.98,
    category: JACKETS,
  },
  {
    slug: 'brown-leather-jacket',
    productSlug: 'washed-leather-jacket-rl005',
    name: 'Washed Leather Jacket',
    colour: 'Chestnut brown',
    tone: '#6b3f26',
    length: 0.98,
    category: JACKETS,
  },
  {
    slug: 'green-sweatshirt',
    productSlug: 'crew-sweatshirt-rl006',
    name: 'Crew Sweatshirt',
    colour: 'Bottle green',
    tone: '#1f7a46',
    length: 0.97,
    category: KNITWEAR,
  },
  {
    slug: 'maroon-hoodie',
    productSlug: 'heavyweight-hoodie-rl007',
    name: 'Heavyweight Hoodie',
    colour: 'Maroon',
    tone: '#7b1630',
    length: 1.06,
    category: HOODIES,
  },
  {
    slug: 'navy-t-shirt',
    productSlug: 'everyday-tee-rl008',
    name: 'Everyday Tee',
    colour: 'Navy',
    tone: '#1d2a4d',
    length: 0.92,
    category: TEES,
  },
];

export function cutoutSrc(piece: ArrivalPiece, view: 'side' | 'front'): string {
  return `/images/homepage/recent-arrivals/${piece.slug}-${view}.webp`;
}
