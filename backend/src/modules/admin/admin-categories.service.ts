import { type Prisma } from '@prisma/client';

import { conflict, notFound, validationFailed } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import type { AdminActionContext } from './customers.service.js';
import type { AdminCategoryCreateBody, AdminCategoryUpdateBody } from './admin-catalog.schemas.js';

// ---------------------------------------------------------------------------
// Admin category views
// ---------------------------------------------------------------------------

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  parentId: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  parent: { select: { id: true, slug: true, name: true } },
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategorySelect;

export interface AdminCategoryFilters {
  readonly q?: string;
  readonly includeInactive?: boolean;
}

export async function adminListCategories(pagination: Pagination, filters: AdminCategoryFilters) {
  const { skip, take } = toSkipTake(pagination);

  const where: Prisma.CategoryWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { slug: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.includeInactive === false ? { isActive: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      skip,
      take,
      select: CATEGORY_SELECT,
    }),
    prisma.category.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      productCount: row._count.products,
      childCount: row._count.children,
    })),
    total,
  };
}

export async function adminGetCategory(categoryId: string) {
  const row = await prisma.category.findUnique({
    where: { id: categoryId },
    select: CATEGORY_SELECT,
  });

  if (!row) {
    throw notFound('That category does not exist.');
  }

  return {
    ...row,
    productCount: row._count.products,
    childCount: row._count.children,
  };
}

export async function adminCreateCategory(
  body: AdminCategoryCreateBody,
  context: AdminActionContext,
) {
  if (body.parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: body.parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throw validationFailed([{ field: 'parentId', issue: 'Parent category does not exist.' }]);
    }
    if (parent.parentId) {
      throw validationFailed([
        { field: 'parentId', issue: 'Only two levels of nesting are supported.' },
      ]);
    }
  }

  const existingSlug = await prisma.category.findUnique({
    where: { slug: body.slug },
    select: { id: true },
  });
  if (existingSlug) {
    throw conflict('A category with that slug already exists.');
  }

  return withTransaction(
    async (tx) => {
      const category = await tx.category.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          parentId: body.parentId ?? null,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
        },
        select: CATEGORY_SELECT,
      });

      await recordAudit(tx, {
        action: AuditAction.CATEGORY_CREATED,
        entityType: 'Category',
        entityId: category.id,
        actor: context.actor,
        after: { name: category.name, slug: category.slug },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return {
        ...category,
        productCount: category._count.products,
        childCount: category._count.children,
      };
    },
    { label: 'admin.createCategory' },
  );
}

export async function adminUpdateCategory(
  categoryId: string,
  body: AdminCategoryUpdateBody,
  context: AdminActionContext,
) {
  const existing = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, slug: true, parentId: true, isActive: true },
  });

  if (!existing) {
    throw notFound('That category does not exist.');
  }

  if (body.parentId !== undefined && body.parentId !== null) {
    if (body.parentId === categoryId) {
      throw validationFailed([
        { field: 'parentId', issue: 'A category cannot be its own parent.' },
      ]);
    }
    const parent = await prisma.category.findUnique({
      where: { id: body.parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throw validationFailed([{ field: 'parentId', issue: 'Parent category does not exist.' }]);
    }
    if (parent.parentId) {
      throw validationFailed([
        { field: 'parentId', issue: 'Only two levels of nesting are supported.' },
      ]);
    }
  }

  const data: Prisma.CategoryUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.slug !== undefined) data.slug = body.slug;
  if (body.description !== undefined) data.description = body.description;
  if (body.parentId !== undefined) {
    data.parent = body.parentId ? { connect: { id: body.parentId } } : { disconnect: true };
  }
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  return withTransaction(
    async (tx) => {
      const category = await tx.category.update({
        where: { id: categoryId },
        data,
        select: CATEGORY_SELECT,
      });

      const before: Record<string, string | number | boolean | null> = {};
      const after: Record<string, string | number | boolean | null> = {};
      if (body.name !== undefined) {
        before.name = existing.name;
        after.name = body.name;
      }
      if (body.slug !== undefined) {
        before.slug = existing.slug;
        after.slug = body.slug;
      }
      if (body.isActive !== undefined) {
        before.isActive = existing.isActive ? 'true' : 'false';
        after.isActive = body.isActive ? 'true' : 'false';
      }

      await recordAudit(tx, {
        action: AuditAction.CATEGORY_UPDATED,
        entityType: 'Category',
        entityId: categoryId,
        actor: context.actor,
        before,
        after,
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return {
        ...category,
        productCount: category._count.products,
        childCount: category._count.children,
      };
    },
    { label: 'admin.updateCategory' },
  );
}
