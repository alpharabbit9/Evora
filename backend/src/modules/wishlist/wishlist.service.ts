import { conflict, notFound } from '../../http/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  type ProductCardView,
  isPublicProduct,
  publicCardsByIds,
} from '../catalog/products.service.js';
import { MAX_WISHLIST_ITEMS } from './wishlist.schemas.js';

/**
 * A customer's saved products (ADR 0016).
 *
 * Ownership: every query is scoped by the session's user id, so a product id in the path can
 * only ever touch the caller's own list — there is no row id to guess and no separate
 * ownership check to forget (invariant 7, same pattern as addresses and the cart).
 *
 * Nothing about a product is stored here but its id. Each read re-reads the catalog, so the
 * list shows today's price and availability, and a product taken down since it was saved
 * drops out of the list the way it drops out of the catalog. Its row is kept: if the product
 * comes back, so does the saved entry.
 */

export interface WishlistItemView {
  readonly savedAt: string;
  readonly product: ProductCardView;
}

export interface WishlistView {
  /** Newest first. Only products the public catalog shows right now. */
  readonly items: readonly WishlistItemView[];
  readonly count: number;
}

export async function getWishlist(userId: string): Promise<WishlistView> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_WISHLIST_ITEMS,
    select: { productId: true, createdAt: true },
  });

  const cards = new Map(
    (await publicCardsByIds(rows.map((row) => row.productId))).map((card) => [card.id, card]),
  );

  const items = rows.flatMap((row) => {
    const product = cards.get(row.productId);
    return product ? [{ savedAt: row.createdAt.toISOString(), product }] : [];
  });

  return { items, count: items.length };
}

/**
 * Idempotent: saving a product that is already saved changes nothing and succeeds, and
 * `createMany({ skipDuplicates })` (`INSERT ... ON CONFLICT DO NOTHING` on the unique
 * (user_id, product_id) index) means two concurrent saves of the same product leave one row
 * instead of one of them failing.
 *
 * Only a product the public catalog shows can be saved, and an unknown id gets the same 404
 * as an unpublished one, so the endpoint cannot be used to probe for drafts.
 */
export async function saveProduct(userId: string, productId: string): Promise<void> {
  if (!(await isPublicProduct(productId))) {
    throw notFound('That product is not available.');
  }

  const existing = await prisma.wishlistItem.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  if ((await prisma.wishlistItem.count({ where: { userId } })) >= MAX_WISHLIST_ITEMS) {
    throw conflict(
      `Your wishlist is full (${String(MAX_WISHLIST_ITEMS)} pieces). Remove one to save another.`,
    );
  }

  await prisma.wishlistItem.createMany({ data: [{ userId, productId }], skipDuplicates: true });
}

/** Idempotent: removing a product that is not saved is not an error. */
export async function removeProduct(userId: string, productId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
}
