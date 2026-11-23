'use client';

import { ArchiveIcon, ImageIcon, PlusIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  type ImageWrite,
  type VariantWrite,
  useAdminProduct,
  useArchiveProduct,
  useDeleteImage,
  useSaveImage,
  useSaveVariant,
} from '@/lib/admin/api';
import { isMajorAmount, majorToMinor, minorToMajor } from '@/lib/admin/price';
import {
  IMAGE_KIND_LABEL,
  PRODUCT_STATUS_LABEL,
  VARIANT_STATUS_LABEL,
  type AdminImage,
  type AdminProduct,
  type AdminVariant,
  type ImageKind,
  type VariantStatus,
} from '@/lib/admin/types';
import { formatMoney } from '@/lib/money';

import { AdminPageSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminQueryState,
  Badge,
  ConfirmDialog,
  FormActions,
  FormError,
  FormField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  formatOptions,
  toOptions,
} from '../admin-ui';
import { ProductForm } from './product-form';
import { PRODUCT_STATUS_TONE } from './products-list';

const SECTION_TITLE = 'text-sm font-semibold';

export function ProductDetailScreen({ productId }: { productId: string }) {
  const product = useAdminProduct(productId);

  return (
    <AdminQueryState
      query={product}
      pending={<AdminPageSkeleton />}
      errorTitle="We couldn't load this product"
      isEmpty={() => false}
    >
      {(data) => <ProductDetail product={data} />}
    </AdminQueryState>
  );
}

function ProductDetail({ product }: { product: AdminProduct }) {
  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        back={{ href: '/admin/products', label: 'Products' }}
        title={product.name}
        description={`/${product.slug}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={PRODUCT_STATUS_TONE[product.status]}>
              {PRODUCT_STATUS_LABEL[product.status]}
            </Badge>
            <ArchiveButton product={product} />
          </div>
        }
      />

      {/* Keyed by the saved version, so the form starts from the server's copy after a save. */}
      <ProductForm key={product.updatedAt} product={product} />
      <VariantsSection product={product} />
      <ImagesSection product={product} />
    </div>
  );
}

function ArchiveButton({ product }: { product: AdminProduct }) {
  const [open, setOpen] = useState(false);
  const archive = useArchiveProduct(product.id);
  const action = useAsyncAction(archive.mutateAsync, {
    toastOnError: false,
    successMessage: 'Product archived.',
    onSuccess: () => {
      setOpen(false);
    },
  });

  if (product.status === 'ARCHIVED') return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          action.reset();
          setOpen(true);
        }}
      >
        <ArchiveIcon aria-hidden="true" />
        Archive
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive ${product.name}?`}
        description="It leaves the store at once. Past orders keep showing it, and it can be set back to draft or published later."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        destructive
        isPending={action.isPending}
        error={action.error}
        onConfirm={() => {
          void action.run();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function VariantsSection({ product }: { product: AdminProduct }) {
  const [editing, setEditing] = useState<AdminVariant | 'new' | null>(null);

  return (
    <section aria-labelledby="variants" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="variants" className={SECTION_TITLE}>
          Variants
        </h2>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditing('new');
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add variant
        </Button>
      </div>

      {product.variants.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No variants yet. A product needs at least one active variant to be bought.
        </p>
      ) : (
        <TableFrame label="Variants">
          <thead>
            <tr className={THEAD_ROW}>
              <th scope="col" className={TH}>
                SKU
              </th>
              <th scope="col" className={TH}>
                Options
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Price
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Stock
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
            {product.variants.map((variant) => (
              <tr key={variant.id} className={TBODY_ROW}>
                <td className={`${TD} font-mono text-xs`}>{variant.sku}</td>
                <td className={TD}>{formatOptions(variant.options)}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {formatMoney(variant.priceMinor, product.currency)}
                  {variant.compareAtPriceMinor !== null ? (
                    <span className="block text-xs text-muted-foreground line-through">
                      {formatMoney(variant.compareAtPriceMinor, product.currency)}
                    </span>
                  ) : null}
                </td>
                <td className={`${TD} text-right tabular-nums`}>
                  <Link
                    href={`/admin/inventory?q=${encodeURIComponent(variant.sku)}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {variant.stockQuantity}
                  </Link>
                  {variant.lowStockThreshold > 0 &&
                  variant.stockQuantity <= variant.lowStockThreshold ? (
                    <span className="block text-xs text-amber-800 dark:text-amber-300">Low</span>
                  ) : null}
                </td>
                <td className={TD}>
                  <Badge tone={variant.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {VARIANT_STATUS_LABEL[variant.status]}
                  </Badge>
                </td>
                <td className={`${TD} text-right`}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(variant);
                    }}
                  >
                    Edit<span className="sr-only"> {variant.sku}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {editing ? (
        <VariantDialog
          product={product}
          variant={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function VariantDialog({
  product,
  variant,
  onClose,
}: {
  product: AdminProduct;
  variant: AdminVariant | undefined;
  onClose: () => void;
}) {
  const save = useSaveVariant(product.id);
  const action = useAsyncAction(save.mutateAsync, {
    toastOnError: false,
    successMessage: variant ? 'Variant saved.' : 'Variant added.',
    onSuccess: onClose,
  });

  // Colour and size are what the store reads (`readOption`); any other option is kept as it was.
  const { color = '', size = '', ...otherOptions } = variant?.options ?? {};
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [colorValue, setColor] = useState(color);
  const [sizeValue, setSize] = useState(size);
  const [price, setPrice] = useState(variant ? minorToMajor(variant.priceMinor) : '');
  const [compareAt, setCompareAt] = useState(
    variant?.compareAtPriceMinor != null ? minorToMajor(variant.compareAtPriceMinor) : '',
  );
  const [threshold, setThreshold] = useState(String(variant?.lowStockThreshold ?? 0));
  const [status, setStatus] = useState<VariantStatus>(variant?.status ?? 'ACTIVE');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const found: Record<string, string> = {};
    const options = {
      ...otherOptions,
      ...(colorValue.trim() ? { color: colorValue.trim() } : {}),
      ...(sizeValue.trim() ? { size: sizeValue.trim() } : {}),
    };

    if (Object.keys(options).length === 0) found.options = 'Give at least a colour or a size';
    if (!isMajorAmount(price)) found.price = 'Enter a price such as 2850 or 2850.50';
    if (compareAt.trim() && !isMajorAmount(compareAt))
      found.compareAt = 'Enter an amount, or leave it blank';
    if (!/^\d{1,6}$/.test(threshold.trim())) found.threshold = 'A whole number, 0 for no alert';

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: VariantWrite = {
      sku: sku.trim(),
      options,
      priceMinor: majorToMinor(price),
      compareAtPriceMinor: compareAt.trim() ? majorToMinor(compareAt) : null,
      lowStockThreshold: Number(threshold),
      status,
    };

    void action.run({ variantId: variant?.id, body });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>{variant ? `Edit ${variant.sku}` : 'Add a variant'}</DialogTitle>
        <DialogDescription>
          {variant
            ? 'Stock is changed from Inventory, so every change is recorded with a reason.'
            : 'A new variant starts with no stock. Add stock from Inventory once it is saved.'}
        </DialogDescription>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField label="SKU" className="sm:col-span-2">
            {(control) => (
              <Input
                {...control}
                required
                maxLength={80}
                value={sku}
                onChange={(event) => {
                  setSku(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label="Colour" error={errors.options}>
            {(control) => (
              <Input
                {...control}
                maxLength={60}
                value={colorValue}
                onChange={(event) => {
                  setColor(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label="Size">
            {(control) => (
              <Input
                {...control}
                maxLength={60}
                value={sizeValue}
                onChange={(event) => {
                  setSize(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={`Price (${product.currency})`} error={errors.price}>
            {(control) => (
              <Input
                {...control}
                required
                inputMode="decimal"
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            label="Was price (optional)"
            hint="Shown struck through."
            error={errors.compareAt}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={compareAt}
                onChange={(event) => {
                  setCompareAt(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label="Low-stock alert at" error={errors.threshold}>
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={threshold}
                onChange={(event) => {
                  setThreshold(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label="Status">
            {(control) => (
              <NativeSelect
                {...control}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as VariantStatus);
                }}
              >
                {toOptions(VARIANT_STATUS_LABEL).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>

          <div className="flex flex-col gap-4 sm:col-span-2">
            <FormError error={action.error} />
            <FormActions
              isPending={action.isPending}
              submitLabel={variant ? 'Save variant' : 'Add variant'}
              pendingLabel="Saving…"
              onCancel={onClose}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Images (metadata only: there is no upload endpoint yet)
// ---------------------------------------------------------------------------

function ImagesSection({ product }: { product: AdminProduct }) {
  const [editing, setEditing] = useState<AdminImage | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminImage | null>(null);
  const remove = useDeleteImage(product.id);
  const removeAction = useAsyncAction(remove.mutateAsync, {
    toastOnError: false,
    successMessage: 'Image removed.',
    onSuccess: () => {
      setDeleting(null);
    },
  });

  return (
    <section aria-labelledby="images" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="images" className={SECTION_TITLE}>
            Images
          </h2>
          <p className="text-xs text-muted-foreground">
            Uploading is not built yet: an image is registered by the key of a file already in
            storage.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditing('new');
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add image
        </Button>
      </div>

      {product.images.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          <ImageIcon className="size-4" aria-hidden="true" />
          No images yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {product.images.map((image) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-muted">
                <Image
                  src={image.url}
                  alt={image.altText}
                  fill
                  sizes="200px"
                  className="object-cover"
                />
              </div>
              <p className="line-clamp-2 text-xs">{image.altText}</p>
              <p className="text-xs text-muted-foreground">
                {IMAGE_KIND_LABEL[image.kind]} · position {image.sortOrder}
              </p>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(image);
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    removeAction.reset();
                    setDeleting(image);
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ImageDialog
          product={product}
          image={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Remove this image?"
        description="It disappears from the product page. The file itself stays in storage."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        destructive
        isPending={removeAction.isPending}
        error={removeAction.error}
        onConfirm={() => {
          if (deleting) void removeAction.run(deleting.id);
        }}
      />
    </section>
  );
}

function ImageDialog({
  product,
  image,
  onClose,
}: {
  product: AdminProduct;
  image: AdminImage | undefined;
  onClose: () => void;
}) {
  const save = useSaveImage(product.id);
  const action = useAsyncAction(save.mutateAsync, {
    toastOnError: false,
    successMessage: image ? 'Image saved.' : 'Image added.',
    onSuccess: onClose,
  });
  const [objectKey, setObjectKey] = useState('');
  const [altText, setAltText] = useState(image?.altText ?? '');
  const [sortOrder, setSortOrder] = useState(String(image?.sortOrder ?? product.images.length));
  const [kind, setKind] = useState<ImageKind>(image?.kind ?? 'PHOTO');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>{image ? 'Edit image' : 'Add an image'}</DialogTitle>
        <DialogDescription>
          Describe what the photo shows for people who cannot see it.
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const body: ImageWrite = {
              ...(image ? {} : { objectKey: objectKey.trim() }),
              altText: altText.trim(),
              sortOrder: Number(sortOrder) || 0,
              kind,
            };
            void action.run({ imageId: image?.id, body });
          }}
        >
          {image ? null : (
            <FormField label="Storage key" hint="For example catalog/my-product/1.jpg">
              {(control) => (
                <Input
                  {...control}
                  required
                  maxLength={512}
                  value={objectKey}
                  onChange={(event) => {
                    setObjectKey(event.target.value);
                  }}
                />
              )}
            </FormField>
          )}
          <FormField label="Description (alt text)">
            {(control) => (
              <Input
                {...control}
                required
                maxLength={500}
                value={altText}
                onChange={(event) => {
                  setAltText(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Position" hint="0 shows first.">
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
            <FormField label="Kind">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as ImageKind);
                  }}
                >
                  {toOptions(IMAGE_KIND_LABEL).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel={image ? 'Save image' : 'Add image'}
            pendingLabel="Saving…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
