import type { SourceRow } from './types.js';

/**
 * The store's category tree and the dark-fashion curation rules that decide which source rows
 * belong in it (docs/fashion-catalog-integration-plan.md §4.1, §2.1).
 *
 * Colours are the SOURCE'S labels. A row is included only if its own `baseColour` is in the
 * rule's palette; nothing is relabelled "black" to suit the brand.
 *
 * The source has one trench coat and no leather or bomber jackets — that gap is documented, not
 * filled with relabelled source rows (plan §3, decision D6). `coats` and `hoodies` exist for the
 * synthetic Dark Edit (`dark-edit.ts`); no Kaggle rule maps to them.
 */
export interface CategoryDefinition {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly parentSlug?: string;
  readonly sortOrder: number;
}

export const CATALOG_CATEGORIES: readonly CategoryDefinition[] = [
  {
    slug: 'outerwear',
    name: 'Outerwear',
    description: 'Jackets, coats and tailored layers.',
    sortOrder: 1,
  },
  {
    slug: 'jackets',
    name: 'Jackets',
    description: 'Dark, minimal jackets.',
    parentSlug: 'outerwear',
    sortOrder: 1,
  },
  {
    slug: 'blazers',
    name: 'Blazers',
    description: 'Tailored blazers.',
    parentSlug: 'outerwear',
    sortOrder: 2,
  },
  {
    slug: 'coats',
    name: 'Coats',
    description: 'Overcoats and trench coats.',
    parentSlug: 'outerwear',
    sortOrder: 3,
  },
  { slug: 'tops', name: 'Tops', description: 'Tees, shirts, knitwear and hoodies.', sortOrder: 2 },
  {
    slug: 't-shirts',
    name: 'T-Shirts & Tops',
    description: 'Black and dark tees and tops.',
    parentSlug: 'tops',
    sortOrder: 1,
  },
  { slug: 'shirts', name: 'Shirts', description: 'Dark shirts.', parentSlug: 'tops', sortOrder: 2 },
  {
    slug: 'knitwear',
    name: 'Knitwear',
    description: 'Sweaters, high necks and sweatshirts.',
    parentSlug: 'tops',
    sortOrder: 3,
  },
  {
    slug: 'hoodies',
    name: 'Hoodies',
    description: 'Pullover and zip hoodies.',
    parentSlug: 'tops',
    sortOrder: 4,
  },
  { slug: 'bottoms', name: 'Bottoms', description: 'Denim and trousers.', sortOrder: 3 },
  {
    slug: 'jeans',
    name: 'Jeans',
    description: 'Black and dark denim.',
    parentSlug: 'bottoms',
    sortOrder: 1,
  },
  {
    slug: 'trousers',
    name: 'Trousers',
    description: 'Tailored and cargo trousers.',
    parentSlug: 'bottoms',
    sortOrder: 2,
  },
  { slug: 'dresses', name: 'Dresses', description: 'Dark, minimal dresses.', sortOrder: 4 },
  {
    slug: 'footwear',
    name: 'Footwear',
    description: 'Boots, dress shoes and dark sneakers.',
    sortOrder: 5,
  },
  { slug: 'boots', name: 'Boots', description: 'Boots.', parentSlug: 'footwear', sortOrder: 1 },
  {
    slug: 'formal-shoes',
    name: 'Dress Shoes',
    description: 'Leather dress shoes.',
    parentSlug: 'footwear',
    sortOrder: 2,
  },
  {
    slug: 'sneakers',
    name: 'Sneakers',
    description: 'Dark casual sneakers.',
    parentSlug: 'footwear',
    sortOrder: 3,
  },
  {
    slug: 'accessories',
    name: 'Accessories',
    description: 'Eyewear, leather goods and jewellery.',
    sortOrder: 6,
  },
  {
    slug: 'sunglasses',
    name: 'Sunglasses',
    description: 'Dark-frame sunglasses.',
    parentSlug: 'accessories',
    sortOrder: 1,
  },
  {
    slug: 'wallets',
    name: 'Wallets',
    description: 'Leather wallets.',
    parentSlug: 'accessories',
    sortOrder: 2,
  },
  {
    slug: 'belts',
    name: 'Belts',
    description: 'Black and brown belts.',
    parentSlug: 'accessories',
    sortOrder: 3,
  },
  {
    slug: 'jewellery',
    name: 'Rings & Chains',
    description: 'Rings, chains and bracelets.',
    parentSlug: 'accessories',
    sortOrder: 4,
  },
  { slug: 'bags', name: 'Bags', description: 'Handbags, messenger and duffel bags.', sortOrder: 7 },
  {
    slug: 'handbags',
    name: 'Handbags',
    description: 'Handbags and clutches.',
    parentSlug: 'bags',
    sortOrder: 1,
  },
  {
    slug: 'messenger-bags',
    name: 'Messenger Bags',
    description: 'Messenger and laptop bags.',
    parentSlug: 'bags',
    sortOrder: 2,
  },
  {
    slug: 'duffel-bags',
    name: 'Duffel Bags',
    description: 'Duffel bags.',
    parentSlug: 'bags',
    sortOrder: 3,
  },
];

const DARK = [
  'Black',
  'Charcoal',
  'Grey',
  'Grey Melange',
  'Navy Blue',
  'Brown',
  'Coffee Brown',
  'Olive',
  'Maroon',
  'Burgundy',
  'Steel',
];
const DARK_TEE = ['Black', 'Charcoal', 'Grey', 'Grey Melange', 'Navy Blue'];
const DARK_DENIM = ['Black', 'Charcoal', 'Grey', 'Navy Blue'];
const LEATHER = ['Black', 'Brown', 'Coffee Brown'];
const METAL = ['Black', 'Silver', 'Steel', 'Grey', 'Charcoal'];

interface Rule {
  readonly category: string;
  readonly colours: readonly string[];
}

/** Keyed by the source's `articleType`. */
const RULES: Record<string, Rule> = {
  Jackets: { category: 'jackets', colours: DARK },
  Blazers: { category: 'blazers', colours: DARK },
  Tshirts: { category: 't-shirts', colours: DARK_TEE },
  Tops: { category: 't-shirts', colours: DARK_TEE },
  Shirts: {
    category: 'shirts',
    colours: ['Black', 'Charcoal', 'Grey', 'Navy Blue', 'Olive', 'Maroon', 'Burgundy'],
  },
  Sweaters: { category: 'knitwear', colours: DARK },
  Sweatshirts: { category: 'knitwear', colours: DARK },
  Jeans: { category: 'jeans', colours: DARK_DENIM },
  Trousers: { category: 'trousers', colours: DARK },
  Dresses: {
    category: 'dresses',
    colours: ['Black', 'Charcoal', 'Navy Blue', 'Maroon', 'Burgundy'],
  },
  'Formal Shoes': { category: 'formal-shoes', colours: LEATHER },
  'Casual Shoes': {
    category: 'sneakers',
    colours: ['Black', 'Charcoal', 'Grey', 'Navy Blue', 'Brown', 'Coffee Brown'],
  },
  Booties: { category: 'boots', colours: DARK },
  Sunglasses: {
    category: 'sunglasses',
    colours: ['Black', 'Grey', 'Brown', 'Coffee Brown', 'Steel', 'Charcoal'],
  },
  Wallets: { category: 'wallets', colours: [...LEATHER, 'Charcoal'] },
  Belts: { category: 'belts', colours: LEATHER },
  Ring: { category: 'jewellery', colours: METAL },
  'Necklace and Chains': { category: 'jewellery', colours: METAL },
  Bracelet: { category: 'jewellery', colours: METAL },
  Handbags: {
    category: 'handbags',
    colours: ['Black', 'Charcoal', 'Brown', 'Coffee Brown', 'Maroon', 'Burgundy'],
  },
  Clutches: { category: 'handbags', colours: ['Black', 'Charcoal', 'Maroon', 'Burgundy'] },
  'Messenger Bag': { category: 'messenger-bags', colours: DARK },
  'Laptop Bag': { category: 'messenger-bags', colours: DARK },
  'Duffel Bag': { category: 'duffel-bags', colours: DARK },
};

/** Any shoe whose own name says "boot" is a boot, whatever its articleType. */
const BOOT_NAME = /\bboots?\b/i;
const FOOTWEAR_TYPES = new Set([
  'Casual Shoes',
  'Formal Shoes',
  'Sports Shoes',
  'Booties',
  'Flats',
  'Heels',
  'Sandals',
]);

/** Per-category ceilings keep ~3,000 curated products instead of 1,000 near-identical tees. */
export const CATEGORY_CAPS: Record<string, number> = {
  't-shirts': 300,
  shirts: 250,
  knitwear: 200,
  jeans: 150,
  trousers: 250,
  jackets: 200,
  blazers: 50,
  dresses: 100,
  'formal-shoes': 200,
  sneakers: 250,
  boots: 100,
  sunglasses: 250,
  wallets: 200,
  belts: 150,
  jewellery: 150,
  handbags: 200,
  'messenger-bags': 100,
  'duffel-bags': 100,
};

export type ExclusionReason =
  'not_adult_line' | 'off_brief_type' | 'off_palette_colour' | 'ethnic_wear' | 'sportswear';

export type Classification =
  | { readonly included: true; readonly categorySlug: string }
  | { readonly included: false; readonly reason: ExclusionReason };

export function classify(row: SourceRow): Classification {
  if (!['Men', 'Women', 'Unisex'].includes(row.gender))
    return { included: false, reason: 'not_adult_line' };
  if (row.usage === 'Ethnic') return { included: false, reason: 'ethnic_wear' };

  if (FOOTWEAR_TYPES.has(row.articleType) && BOOT_NAME.test(row.name)) {
    return DARK.includes(row.baseColour)
      ? { included: true, categorySlug: 'boots' }
      : { included: false, reason: 'off_palette_colour' };
  }

  const rule = RULES[row.articleType];
  if (!rule) return { included: false, reason: 'off_brief_type' };
  // Gym and team kit reads as sportswear, not as the store's look.
  if (row.masterCategory === 'Apparel' && row.usage === 'Sports')
    return { included: false, reason: 'sportswear' };
  if (!rule.colours.includes(row.baseColour))
    return { included: false, reason: 'off_palette_colour' };

  return { included: true, categorySlug: rule.category };
}
