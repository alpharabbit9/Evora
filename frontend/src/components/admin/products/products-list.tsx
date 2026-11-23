'use client';

import { PackageIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { buttonVariants } from '@/components/ui/button';
import {
  ADMIN_PAGE_SIZE,
  categoryLabel,
  useAdminProducts,
  useCategoryOptions,
} from '@/lib/admin/api';
import {
  GENDER_LABEL,
  PRODUCT_STATUS_LABEL,
  type ProductGender,
  type ProductStatus,
} from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  FilterBar,
  FilterSelect,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDate,
  toOptions,
} from '../admin-ui';

const STATUSES = Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[];
const GENDERS = Object.keys(GENDER_LABEL) as ProductGender[];

export const PRODUCT_STATUS_TONE = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
} as const;

export function ProductsList() {
  const params = useListParams();
  const categories = useCategoryOptions();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    status: params.getOneOf('status', STATUSES),
    gender: params.getOneOf('gender', GENDERS),
    categoryId: params.get('categoryId'),
  };
  const products = useAdminProducts(filters);
  const filtered = Boolean(filters.q ?? filters.status ?? filters.gender ?? filters.categoryId);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Products"
        description="Drafts are hidden from the store until published. Archived products stay on past orders."
        action={
          <Link href="/admin/products/new" className={buttonVariants()}>
            <PlusIcon aria-hidden="true" />
            New product
          </Link>
        }
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="Name, brand or SKU"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(status) => {
            params.set({ status });
          }}
          options={toOptions(PRODUCT_STATUS_LABEL)}
        />
        <FilterSelect
          label="Gender"
          value={filters.gender}
          onChange={(gender) => {
            params.set({ gender });
          }}
          options={toOptions(GENDER_LABEL)}
        />
        <FilterSelect
          label="Category"
          value={filters.categoryId}
          disabled={!categories.data}
          onChange={(categoryId) => {
            params.set({ categoryId });
          }}
          options={(categories.data ?? []).map((category) => ({
            value: category.id,
            label: categoryLabel(category),
          }))}
        />
      </FilterBar>

      <AdminQueryState
        query={products}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load products"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<PackageIcon className="size-6" strokeWidth={1.25} />}
            title={filtered ? 'No products match these filters' : 'No products yet'}
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Products" stale={products.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Product
                  </th>
                  <th scope="col" className={TH}>
                    Category
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Variants
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Images
                  </th>
                  <th scope="col" className={TH}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((product) => (
                  <tr key={product.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <Link
                        href={`/admin/products/${product.id}`}
                        className={`font-medium underline-offset-4 hover:underline ${focusRing}`}
                      >
                        {product.name}
                      </Link>
                      {product.brand ? (
                        <span className="block text-xs text-muted-foreground">{product.brand}</span>
                      ) : null}
                    </td>
                    <td className={`${TD} text-muted-foreground`}>{product.category.name}</td>
                    <td className={TD}>
                      <Badge tone={PRODUCT_STATUS_TONE[product.status]}>
                        {PRODUCT_STATUS_LABEL[product.status]}
                      </Badge>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{product.variantCount}</td>
                    <td className={`${TD} text-right tabular-nums`}>{product.imageCount}</td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDate(product.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="products"
            />
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
