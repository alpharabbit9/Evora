import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { LISTING_FROM } from './catalog.query.js';
import { PUBLIC_PRODUCT_SQL } from './publication.js';

/**
 * Public category navigation (API_SPEC.md §4, `GET /categories`).
 *
 * Two levels, matching the catalog: top-level groups (Footwear, Bags, …) and the leaf
 * categories products are filed under. A category is listed only when it is active, its
 * parent (if any) is active, and it — or one of its children — has at least one public
 * product. An empty shelf in the navigation is a link to an empty page.
 */
export interface CategoryNode {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  /** Public products filed here, including those in child categories. */
  readonly productCount: number;
  readonly children: readonly Omit<CategoryNode, 'children'>[];
}

export async function listPublicCategories(): Promise<CategoryNode[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, description: true, parentId: true },
    }),
    prisma.$queryRaw<{ id: string; count: number }[]>(Prisma.sql`
      SELECT c.id, COUNT(*)::int AS count
      ${LISTING_FROM} WHERE ${PUBLIC_PRODUCT_SQL}
      GROUP BY c.id`),
  ]);

  const ownCount = new Map(counts.map((row) => [row.id, row.count]));
  const activeIds = new Set(categories.map((category) => category.id));

  const roots = categories.filter((category) => category.parentId === null);

  return roots
    .map((root) => {
      const children = categories
        .filter((child) => child.parentId === root.id && activeIds.has(root.id))
        .map((child) => ({
          slug: child.slug,
          name: child.name,
          description: child.description,
          productCount: ownCount.get(child.id) ?? 0,
        }))
        .filter((child) => child.productCount > 0);

      return {
        slug: root.slug,
        name: root.name,
        description: root.description,
        productCount:
          (ownCount.get(root.id) ?? 0) +
          children.reduce((sum, child) => sum + child.productCount, 0),
        children,
      };
    })
    .filter((root) => root.productCount > 0);
}
