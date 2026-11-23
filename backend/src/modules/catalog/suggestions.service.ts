import type { ImageView } from '../../lib/media.js';
import { productListQuery } from './catalog.schemas.js';
import { searchTerms } from './catalog.query.js';
import { listPublicCategories } from './categories.service.js';
import { listProducts } from './products.service.js';

/**
 * Search-as-you-type (API_SPEC.md §4, `GET /search/suggestions`).
 *
 * Not a second search engine: the products are the first page of the same listing query
 * `/search` runs, relevance order included, so a suggestion can never be something the results
 * page would not show. The publication rule therefore applies exactly as it does there.
 * Categories are matched against the public navigation tree, so an empty or switched-off shelf
 * is never suggested.
 */
export const MAX_PRODUCT_SUGGESTIONS = 5;
export const MAX_CATEGORY_SUGGESTIONS = 3;

export interface ProductSuggestion {
  readonly slug: string;
  readonly name: string;
  readonly brand: string | null;
  readonly currency: string;
  readonly priceMinor: number;
  readonly maxPriceMinor: number;
  readonly image: ImageView | null;
}

export interface CategorySuggestion {
  readonly slug: string;
  readonly name: string;
  /** The parent's name for a child category ("Footwear" for Boots), so two can be told apart. */
  readonly parentName: string | null;
}

export interface SearchSuggestions {
  readonly products: readonly ProductSuggestion[];
  readonly categories: readonly CategorySuggestion[];
  /** How many products the full search would list, for "See all N results". */
  readonly totalProducts: number;
}

export async function getSearchSuggestions(q: string): Promise<SearchSuggestions> {
  const terms = searchTerms(q);

  const [page, tree] = await Promise.all([
    listProducts(productListQuery.parse({ q, pageSize: MAX_PRODUCT_SUGGESTIONS })),
    listPublicCategories(),
  ]);

  const categories: CategorySuggestion[] = tree
    .flatMap((root) => [
      { slug: root.slug, name: root.name, parentName: null },
      ...root.children.map((child) => ({
        slug: child.slug,
        name: child.name,
        parentName: root.name,
      })),
    ])
    .filter((category) => {
      const name = category.name.toLowerCase();
      return terms.every((term) => name.includes(term));
    })
    .slice(0, MAX_CATEGORY_SUGGESTIONS);

  return {
    products: page.items.map((card) => ({
      slug: card.slug,
      name: card.name,
      brand: card.brand,
      currency: card.currency,
      priceMinor: card.priceMinor,
      maxPriceMinor: card.maxPriceMinor,
      image: card.image,
    })),
    categories,
    totalProducts: page.total,
  };
}
