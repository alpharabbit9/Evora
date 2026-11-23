'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  type ProductWrite,
  categoryLabel,
  useCategoryOptions,
  useCreateProduct,
  useUpdateProduct,
} from '@/lib/admin/api';
import {
  GENDER_LABEL,
  PRODUCT_STATUS_LABEL,
  type AdminProduct,
  type ProductGender,
  type ProductStatus,
} from '@/lib/admin/types';

import { FormError, FormField, toOptions } from '../admin-ui';

interface Draft {
  name: string;
  slug: string;
  brand: string;
  description: string;
  categoryId: string;
  gender: ProductGender | '';
  status: ProductStatus;
  featuredRank: string;
}

function toDraft(product: AdminProduct | undefined): Draft {
  return {
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    categoryId: product?.category.id ?? '',
    gender: product?.gender ?? '',
    status: product?.status ?? 'DRAFT',
    featuredRank: product?.featuredRank === null || !product ? '' : String(product.featuredRank),
  };
}

/** Blank optional text is "none", not an empty string the API would have to interpret. */
function toWrite(draft: Draft, creating: boolean): ProductWrite {
  const rank = draft.featuredRank.trim();

  return {
    name: draft.name.trim(),
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    brand: draft.brand.trim() || null,
    description: draft.description.trim() || null,
    categoryId: draft.categoryId,
    gender: draft.gender || null,
    status: draft.status,
    ...(rank ? { featuredRank: Number(rank) } : creating ? {} : { featuredRank: null }),
  };
}

/**
 * Create and edit share one form. A new product starts as a draft, which the store does not
 * show, so it can be given variants and images before it is published.
 */
export function ProductForm({ product }: { product?: AdminProduct }) {
  const router = useRouter();
  const categories = useCategoryOptions();
  const create = useCreateProduct();
  const update = useUpdateProduct(product?.id ?? '');
  const [draft, setDraft] = useState(() => toDraft(product));
  const [rankError, setRankError] = useState<string | undefined>();
  const creating = !product;

  const save = useAsyncAction(
    (body: ProductWrite) => (creating ? create.mutateAsync(body) : update.mutateAsync(body)),
    {
      toastOnError: false,
      successMessage: creating ? 'Product created as a draft.' : 'Product saved.',
      onSuccess: (saved) => {
        if (creating) router.push(`/admin/products/${saved.id}`);
      },
    },
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const rank = draft.featuredRank.trim();

        if (rank && !/^[1-9]\d{0,5}$/.test(rank)) {
          setRankError('A whole number from 1, or leave it blank');
          return;
        }

        setRankError(undefined);
        void save.run(toWrite(draft, creating));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" className="sm:col-span-2">
          {(control) => (
            <Input
              {...control}
              required
              maxLength={255}
              value={draft.name}
              onChange={(event) => {
                set('name', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          label="URL slug"
          hint={
            creating ? 'Leave blank to make one from the name.' : 'Changing it breaks old links.'
          }
        >
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={draft.slug}
              onChange={(event) => {
                set('slug', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Brand (optional)">
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={draft.brand}
              onChange={(event) => {
                set('brand', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Category">
          {(control) => (
            <NativeSelect
              {...control}
              required
              disabled={!categories.data}
              value={draft.categoryId}
              onChange={(event) => {
                set('categoryId', event.target.value);
              }}
            >
              <option value="" disabled>
                {categories.isPending ? 'Loading categories…' : 'Choose a category'}
              </option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label="Gender">
          {(control) => (
            <NativeSelect
              {...control}
              value={draft.gender}
              onChange={(event) => {
                set('gender', event.target.value as ProductGender | '');
              }}
            >
              <option value="">Not set</option>
              {toOptions(GENDER_LABEL).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          label="Status"
          hint="Published products appear in the store once they have an active variant."
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={draft.status}
              onChange={(event) => {
                set('status', event.target.value as ProductStatus);
              }}
            >
              {toOptions(PRODUCT_STATUS_LABEL).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          label="Featured position (optional)"
          hint="1 shows first in the default listing."
          error={rankError}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              value={draft.featuredRank}
              onChange={(event) => {
                set('featuredRank', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Description (optional)" className="sm:col-span-2">
          {(control) => (
            <Textarea
              {...control}
              rows={5}
              maxLength={5000}
              value={draft.description}
              onChange={(event) => {
                set('description', event.target.value);
              }}
            />
          )}
        </FormField>
      </div>

      <FormError error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : creating ? 'Create product' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
