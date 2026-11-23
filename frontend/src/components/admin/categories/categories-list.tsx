'use client';

import { PlusIcon, TagsIcon } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  ADMIN_PAGE_SIZE,
  type CategoryWrite,
  useAdminCategories,
  useCategoryOptions,
  useSaveCategory,
} from '@/lib/admin/api';
import type { AdminCategory } from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  FilterBar,
  FilterSelect,
  FormActions,
  FormError,
  FormField,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
} from '../admin-ui';

/** Two levels at most (a parent and its children), which the API enforces. */
export function CategoriesList() {
  const params = useListParams();
  const showing = params.getOneOf('show', ['active'] as const);
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    includeInactive: showing === 'active' ? 'false' : 'true',
  };
  const categories = useAdminCategories(filters);
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Categories"
        description="An inactive category hides its products from the store's navigation."
        action={
          <Button
            type="button"
            onClick={() => {
              setEditing('new');
            }}
          >
            <PlusIcon aria-hidden="true" />
            New category
          </Button>
        }
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="Name or slug"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="Show"
          value={showing}
          onChange={(show) => {
            params.set({ show });
          }}
          options={[{ value: 'active', label: 'Active only' }]}
        />
      </FilterBar>

      <AdminQueryState
        query={categories}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load categories"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<TagsIcon className="size-6" strokeWidth={1.25} />}
            title="No categories match"
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Categories" stale={categories.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Category
                  </th>
                  <th scope="col" className={TH}>
                    Parent
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Products
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Position
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((category) => (
                  <tr key={category.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <span className="block font-medium">{category.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {category.slug}
                      </span>
                    </td>
                    <td className={`${TD} text-muted-foreground`}>
                      {category.parent?.name ?? '—'}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{category.productCount}</td>
                    <td className={`${TD} text-right tabular-nums`}>{category.sortOrder}</td>
                    <td className={TD}>
                      <Badge tone={category.isActive ? 'success' : 'neutral'}>
                        {category.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className={`${TD} text-right`}>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(category);
                        }}
                      >
                        Edit<span className="sr-only"> {category.name}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="categories"
              one="category"
            />
          </div>
        )}
      </AdminQueryState>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function CategoryDialog({
  category,
  onClose,
}: {
  category: AdminCategory | undefined;
  onClose: () => void;
}) {
  const options = useCategoryOptions();
  const save = useSaveCategory();
  const action = useAsyncAction(save.mutateAsync, {
    toastOnError: false,
    successMessage: category ? 'Category saved.' : 'Category created.',
    onSuccess: onClose,
  });
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));

  // Only a top-level category can be a parent, and never the category itself.
  const parents = (options.data ?? []).filter(
    (candidate) => candidate.parentId === null && candidate.id !== category?.id,
  );
  const hasChildren = (category?.childCount ?? 0) > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>{category ? `Edit ${category.name}` : 'New category'}</DialogTitle>
        <DialogDescription>
          {category
            ? 'Changing the slug changes its address in the store.'
            : 'It appears in the store once it is active and has published products.'}
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const body: CategoryWrite = {
              name: name.trim(),
              slug: slug.trim() || slugify(name),
              description: description.trim() || null,
              parentId: parentId || null,
              isActive,
              sortOrder: Number(sortOrder) || 0,
            };
            void action.run({ categoryId: category?.id, body });
          }}
        >
          <FormField label="Name">
            {(control) => (
              <Input
                {...control}
                required
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            label="Slug"
            hint={category ? undefined : 'Leave blank to make one from the name.'}
          >
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            label="Parent"
            hint={hasChildren ? 'It has sub-categories, so it stays at the top level.' : undefined}
          >
            {(control) => (
              <NativeSelect
                {...control}
                disabled={hasChildren || !options.data}
                value={parentId}
                onChange={(event) => {
                  setParentId(event.target.value);
                }}
              >
                <option value="">None (top level)</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Position" hint="Lower comes first.">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  value={sortOrder}
                  onChange={(event) => {
                    setSortOrder(event.target.value);
                  }}
                />
              )}
            </FormField>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => {
                  setIsActive(event.target.checked);
                }}
                className="size-4 accent-foreground"
              />
              Active
            </label>
          </div>
          <FormField label="Description (optional)">
            {(control) => (
              <Textarea
                {...control}
                maxLength={1000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel={category ? 'Save category' : 'Create category'}
            pendingLabel="Saving…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
