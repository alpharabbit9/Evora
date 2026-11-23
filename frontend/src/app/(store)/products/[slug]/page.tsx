import {
  PaletteIcon,
  RulerIcon,
  ShirtIcon,
  TagIcon,
  UserRoundIcon,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, cache } from 'react';

import { DemoNotice } from '@/components/catalog/catalog-header';
import { ProductImage } from '@/components/catalog/product-image';
import { PageTransition } from '@/components/layout/page-transition';
import { ProductGallery } from '@/components/product/product-gallery';
import { ProductInfoTabs } from '@/components/product/product-info-tabs';
import {
  PRODUCT_COLUMNS as COLUMNS,
  PRODUCT_CONTAINER as CONTAINER,
} from '@/components/product/product-layout';
import { ProductPurchase } from '@/components/product/product-purchase';
import { ProductSkeleton } from '@/components/product/product-skeleton';
import { DETAILS_TAB, SHIPPING_TAB, SIZE_AND_FIT_TAB } from '@/components/product/product-tab-ids';
import { RelatedProducts, RelatedProductsSkeleton } from '@/components/product/related-products';
import { ScrollParallax } from '@/components/storefront/scroll-motion';
import { BENEFITS } from '@/components/storefront/why-shop-with-us/benefits';
import { ApiErrorCode, isApiError } from '@/lib/api-error';
import { fetchProduct } from '@/lib/catalog/api';
import { visiblePolicyContent } from '@/lib/content-gates';
import { ENTER, ENTER_MASK } from '@/lib/motion/enter';
import { cn } from '@/lib/utils';
import type { ProductDetail } from '@/lib/catalog/types';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GENDER_LABEL = { men: 'Men', women: 'Women', unisex: 'Unisex' } as const;
const CUT_COPY = { men: 'Cut for men', women: 'Cut for women', unisex: 'Unisex fit' } as const;

const DETAIL_SIZES = '(min-width: 1024px) 44vw, 100vw';

/**
 * The store promises shown beside "Add to bag" and in the Shipping tab — the same copy as the
 * home page's service strip, so the two cannot disagree. See `benefits.ts` for
 * which of these still wait on a decided policy: a production build leaves those out
 * (ADR 0026), so the row below sizes its columns to however many remain.
 */
const SERVICE_PROMISES = ['shipping', 'returns', 'payment'].flatMap((id) =>
  visiblePolicyContent(BENEFITS).filter((benefit) => benefit.id === id),
);

/**
 * One product, by slug, read from the API at request time — price and availability must be
 * current, so it is not cached (architecture.md §10). `cache()` only de-duplicates the read
 * between `generateMetadata` and the page within one request.
 *
 * A missing, draft or archived product answers the same 404 from the API, which becomes
 * `notFound()` here. Any other failure is thrown to this segment's `error.tsx`.
 */
const loadProduct = cache(async (slug: string): Promise<ProductDetail | null> => {
  if (!SLUG.test(slug) || slug.length > 160) {
    return null;
  }

  try {
    return await fetchProduct(slug);
  } catch (error) {
    if (isApiError(error) && error.code === ApiErrorCode.NOT_FOUND) {
      return null;
    }
    throw error;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/products/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug).catch(() => null);

  if (!product) {
    return { title: 'Product not found' };
  }

  return {
    title: product.name,
    description: product.description?.slice(0, 160) ?? `${product.name} — ${product.category.name}`,
  };
}

export default function ProductPage({ params }: PageProps<'/products/[slug]'>) {
  return (
    <PageTransition>
      <Suspense fallback={<ProductSkeleton />}>
        {params.then(({ slug }) => (
          <ProductContent slug={slug} />
        ))}
      </Suspense>
    </PageTransition>
  );
}

/**
 * Gallery and purchase panel side by side from `lg` (stacked below it), then the information
 * tabs beside a detail photo, then related products, which stream in on their own so a slow
 * listing read never holds back the product itself.
 *
 * Motion (pages-plan.md P4, ADR 0010):
 * - Entrance, CSS (`lib/motion/enter.ts`), as the product streams in: the gallery settles from
 *   98% as it fades in; the name rises out of its mask; the purchase panel and the service row
 *   follow. Nothing waits on hydration; reduced motion shows everything at once.
 * - The detail photo drifts against the scroll (`ScrollParallax`, GSAP; still under reduced
 *   motion). It owns the wrapper's transform; the crop's scale stays on the image inside.
 * - Related products: see `RelatedProducts`.
 */
async function ProductContent({ slug }: { slug: string }) {
  const product = await loadProduct(slug);

  if (!product) {
    notFound();
  }

  const { category } = product;
  // A second photo when there is one; otherwise a close crop of the first, as a texture
  // study. The crop repeats an image already described above, so it is decorative.
  const detailImage = product.images[1] ?? product.images[0] ?? null;
  const detailIsCrop = !product.images[1];

  return (
    <article className={`${CONTAINER} pt-6 pb-24`}>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          <li>
            <Link href="/shop" className="hover:text-foreground">
              Shop
            </Link>
          </li>
          {category.parent ? (
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <Link
                href={`/shop?category=${category.parent.slug}`}
                className="hover:text-foreground"
              >
                {category.parent.name}
              </Link>
            </li>
          ) : null}
          <li className="flex items-center gap-2">
            <span aria-hidden="true">/</span>
            <Link href={`/shop?category=${category.slug}`} className="hover:text-foreground">
              {category.name}
            </Link>
          </li>
        </ol>
      </nav>

      <div className={`mt-6 ${COLUMNS}`}>
        <div className={cn(ENTER, 'duration-[1200ms] zoom-in-98')}>
          <ProductGallery images={product.images} name={product.name} />
        </div>

        <div className="flex flex-col gap-6 self-start md:sticky md:top-28">
          <header className="flex flex-col items-start gap-3">
            <p
              className={cn(
                ENTER,
                'flex flex-wrap items-center gap-2 delay-100 slide-in-from-bottom-2',
              )}
            >
              <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-foreground">
                {category.name}
              </span>
              {product.brand ? (
                <span className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
                  {product.brand}
                </span>
              ) : null}
            </p>
            <h1
              className={cn(
                ENTER_MASK,
                'font-heading text-[clamp(1.85rem,1.4rem+1.6vw,2.75rem)] leading-[1.08] font-normal tracking-[-0.01em] text-balance',
              )}
            >
              <span className={cn(ENTER, 'block delay-150 slide-in-from-bottom-full')}>
                {product.name}
              </span>
            </h1>
            {product.description ? (
              <p
                className={cn(
                  ENTER,
                  'line-clamp-3 max-w-prose text-sm leading-6 text-muted-foreground delay-300 slide-in-from-bottom-3',
                )}
              >
                {product.description}
              </p>
            ) : null}
          </header>

          <div
            className={cn(
              ENTER,
              'border-t border-border pt-6 delay-[400ms] slide-in-from-bottom-3',
            )}
          >
            <ProductPurchase product={product} />
          </div>

          <ul
            className={cn(
              ENTER,
              'grid auto-cols-fr grid-flow-col gap-3 border-t border-border pt-5 delay-500',
            )}
          >
            {SERVICE_PROMISES.map(({ id, title, description, icon: Icon }) => (
              <li
                key={id}
                className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2.5 md:flex-col lg:flex-row"
              >
                <Icon className="size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <p className="text-xs leading-tight font-medium">{title}</p>
                  <p className="mt-1 hidden text-[11px] leading-snug text-muted-foreground sm:block md:hidden lg:block">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <DemoNotice className={cn(ENTER, 'text-xs leading-5 text-muted-foreground delay-500')} />
        </div>
      </div>

      <section
        aria-label="Product information"
        className={`mt-16 grid gap-8 sm:mt-20 lg:gap-12 xl:gap-16 ${detailImage ? 'lg:grid-cols-2 lg:items-start' : ''}`}
      >
        <ProductInfoTabs
          label="Product information"
          tabs={[
            { id: DETAILS_TAB, label: 'Details', content: <DetailsPanel product={product} /> },
            {
              id: SIZE_AND_FIT_TAB,
              label: 'Size & Fit',
              content: <SizeAndFitPanel product={product} />,
            },
            { id: SHIPPING_TAB, label: 'Shipping & Returns', content: <ShippingPanel /> },
          ]}
        />

        {detailImage ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted lg:aspect-[16/11]">
            <ScrollParallax travel={5} decorative={detailIsCrop}>
              <ProductImage
                image={detailIsCrop ? { ...detailImage, alt: '' } : detailImage}
                sizes={DETAIL_SIZES}
                {...(detailIsCrop ? { className: 'scale-[1.6] object-[50%_40%]' } : {})}
              />
            </ScrollParallax>
          </div>
        ) : null}
      </section>

      <div className="mt-16 sm:mt-20">
        <Suspense fallback={<RelatedProductsSkeleton />}>
          <RelatedProducts slug={product.slug} category={category} />
        </Suspense>
      </div>
    </article>
  );
}

function FeatureList({ items }: { items: readonly { icon: LucideIcon; text: string }[] }) {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-3">
          <Icon
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {text}
        </li>
      ))}
    </ul>
  );
}

function DetailsPanel({ product }: { product: ProductDetail }) {
  const items = [
    { icon: ShirtIcon, text: product.category.name },
    ...(product.gender ? [{ icon: UserRoundIcon, text: CUT_COPY[product.gender] }] : []),
    ...(product.colors.length > 0
      ? [{ icon: PaletteIcon, text: `Colour: ${product.colors.join(', ')}` }]
      : []),
    ...(product.sizes.length > 0
      ? [{ icon: RulerIcon, text: `Sizes ${product.sizes.join(' · ')}` }]
      : []),
    ...(product.brand ? [{ icon: TagIcon, text: `By ${product.brand}` }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      {product.description ? (
        <p className="max-w-prose text-sm leading-7 whitespace-pre-line text-foreground/85">
          {product.description}
        </p>
      ) : null}
      <FeatureList items={items} />
    </div>
  );
}

function SizeAndFitPanel({ product }: { product: ProductDetail }) {
  return (
    <div className="flex flex-col gap-5 text-sm leading-7 text-foreground/85">
      {product.sizes.length > 0 ? (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Sizes this piece is made in">
            {product.sizes.map((size) => (
              <li
                key={size}
                className="grid h-9 min-w-12 place-items-center rounded-md border border-border px-3 text-xs font-medium tabular-nums"
              >
                {size}
              </li>
            ))}
          </ul>
          <p className="max-w-prose">
            {product.gender ? `${CUT_COPY[product.gender]}. ` : ''}Sizes follow the brand’s own
            labelling; a measurement chart isn’t published for this piece yet. Sold-out sizes are
            struck through in the size picker.
          </p>
        </>
      ) : (
        <p className="max-w-prose">This piece comes in one size.</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">Category</dt>
        <dd>{product.category.name}</dd>
        {product.gender ? (
          <>
            <dt className="text-muted-foreground">Cut for</dt>
            <dd>{GENDER_LABEL[product.gender]}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function ShippingPanel() {
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-4">
        {SERVICE_PROMISES.map(({ id, title, description, icon: Icon }) => (
          <li key={id} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-sm leading-6 text-foreground/85">
        Delivery options and fees are calculated at checkout for your address, before you pay.
      </p>
    </div>
  );
}
