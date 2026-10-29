/**
 * Response shapes of the public catalog and cart endpoints (backend `modules/catalog`,
 * `modules/cart`; API_SPEC.md §4–5).
 *
 * Money is integer minor units (poisha) in `currency`, never a float (ADR 0008). Prices,
 * totals and availability shown from these are display copies of the server's numbers; the
 * cart and checkout recompute them on the server and never accept them back.
 */
import type { ApiPage } from '@/lib/api-client';

export type Gender = 'men' | 'women' | 'unisex';

export type ProductSort =
  'relevance' | 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'name_asc';

export type Availability = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface ImageView {
  readonly url: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface CategoryRef {
  readonly slug: string;
  readonly name: string;
}

export interface ProductCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: string | null;
  readonly gender: Gender | null;
  readonly category: CategoryRef;
  readonly currency: string;
  readonly priceMinor: number;
  readonly maxPriceMinor: number;
  readonly compareAtPriceMinor: number | null;
  readonly colors: readonly string[];
  readonly inStock: boolean;
  readonly image: ImageView | null;
}

export interface ProductVariant {
  readonly id: string;
  readonly sku: string;
  readonly color: string | null;
  readonly size: string | null;
  readonly priceMinor: number;
  readonly compareAtPriceMinor: number | null;
  readonly availability: Availability;
}

export interface ProductDetail extends Omit<ProductCard, 'image' | 'category'> {
  readonly description: string | null;
  readonly category: CategoryRef & { readonly parent: CategoryRef | null };
  readonly images: readonly ImageView[];
  readonly sizes: readonly string[];
  readonly variants: readonly ProductVariant[];
}

export type ProductPage = ApiPage<ProductCard>;

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

export interface ProductFacets {
  readonly total: number;
  readonly currency: string;
  readonly price: { readonly minMinor: number; readonly maxMinor: number } | null;
  readonly categories: readonly (CategoryRef & { readonly count: number })[];
  readonly colors: readonly FacetValue[];
  readonly sizes: readonly FacetValue[];
  readonly brands: readonly FacetValue[];
}

export interface CategoryNode extends CategoryRef {
  readonly description: string | null;
  readonly productCount: number;
  readonly children: readonly Omit<CategoryNode, 'children'>[];
}

export type CartLineStatus = 'available' | 'insufficient_stock' | 'out_of_stock' | 'unavailable';

export interface CartLine {
  readonly id: string;
  readonly quantity: number;
  readonly status: CartLineStatus;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly variant: {
    readonly id: string;
    readonly sku: string;
    readonly color: string | null;
    readonly size: string | null;
  };
  readonly product: {
    readonly slug: string;
    readonly name: string;
    readonly brand: string | null;
    readonly image: ImageView | null;
  };
}

export interface Cart {
  readonly id: string | null;
  readonly currency: string;
  readonly items: readonly CartLine[];
  readonly itemCount: number;
  readonly subtotalMinor: number;
  readonly hasIssues: boolean;
}
