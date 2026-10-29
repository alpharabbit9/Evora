'use client';

import { CheckIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ListingPreset, ListingState } from '@/lib/catalog/listing-params';
import type { CategoryNode, Gender, ProductFacets } from '@/lib/catalog/types';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

import { ColorSwatch } from './color-swatch';

export type ListingChanges = Record<
  string,
  string | readonly string[] | number | boolean | undefined
>;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const GENDER_OPTIONS: { value: Gender | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'men', label: 'Men' },
  { value: 'women', label: 'Women' },
  { value: 'unisex', label: 'Unisex' },
];

/** Brands shown before "Show all". */
const BRAND_PREVIEW = 8;

function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/**
 * The listing's filter panel. Every control writes to the URL through `onChange`; nothing
 * here holds filter state of its own except the price inputs while they are being typed.
 *
 * Options and counts come from `/products/facets` for the current scope (gender, category,
 * search), so the panel only offers values that lead somewhere. Choosing a colour does not
 * hide the other colours.
 */
export function CatalogFilters({
  state,
  preset,
  facets,
  categories,
  onChange,
}: {
  state: ListingState;
  preset: ListingPreset;
  facets: ProductFacets | undefined;
  categories: readonly CategoryNode[] | undefined;
  onChange: (changes: ListingChanges) => void;
}) {
  if (!facets) {
    return (
      <div className="flex flex-col gap-8" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>
    );
  }

  const selectedSizes = state.size.map((size) => size.toUpperCase());

  return (
    <div className="flex flex-col gap-9">
      <CategoryFilter
        selected={state.category}
        categories={categories}
        counts={facets.categories}
        onSelect={(category) => {
          // Sizes differ by category (UK8 vs M); a size chosen for one is meaningless in another.
          onChange({ category, size: undefined });
        }}
      />

      {preset.gender ? null : (
        <FilterSection title="Shop for">
          <div className="flex flex-wrap gap-2">
            {GENDER_OPTIONS.map((option) => (
              <Chip
                key={option.label}
                pressed={state.gender === option.value}
                onClick={() => {
                  onChange({ gender: option.value });
                }}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </FilterSection>
      )}

      {facets.colors.length > 0 ? (
        <FilterSection title="Colour">
          <ul className="flex flex-col gap-1.5">
            {facets.colors.map((color) => (
              <li key={color.value}>
                <OptionButton
                  pressed={state.color.includes(color.value)}
                  count={color.count}
                  onClick={() => {
                    onChange({ color: toggle(state.color, color.value) });
                  }}
                >
                  <ColorSwatch color={color.value} className="size-3.5" />
                  {color.value}
                </OptionButton>
              </li>
            ))}
          </ul>
        </FilterSection>
      ) : null}

      <FilterSection title="Size">
        {state.category ? (
          facets.sizes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {facets.sizes.map((size) => (
                <Chip
                  key={size.value}
                  pressed={selectedSizes.includes(size.value)}
                  onClick={() => {
                    onChange({ size: toggle(selectedSizes, size.value) });
                  }}
                >
                  {size.value}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">These items come in one size.</p>
          )
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Choose a category to filter by size.
          </p>
        )}
      </FilterSection>

      {facets.brands.length > 0 ? (
        <BrandFilter
          brands={facets.brands}
          selected={state.brand}
          onToggle={(brand) => {
            onChange({ brand: toggle(state.brand, brand) });
          }}
        />
      ) : null}

      <PriceFilter
        // Remount when the URL changes so the inputs show what is actually applied.
        key={`${String(state.min)}-${String(state.max)}`}
        min={state.min}
        max={state.max}
        range={facets.price}
        currency={facets.currency}
        onApply={(min, max) => {
          onChange({ min, max });
        }}
      />

      <FilterSection title="Availability">
        <OptionButton
          pressed={state.inStock}
          onClick={() => {
            onChange({ inStock: !state.inStock });
          }}
        >
          In stock only
        </OptionButton>
      </FilterSection>
    </div>
  );
}

/**
 * The visible count is a bare number beside the label; screen readers would otherwise read
 * the two run together ("Footwear373"), so they get ", 373 products" instead.
 */
function ProductCount({ count, className }: { count: number; className: string }) {
  return (
    <span className={className}>
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> {count === 1 ? 'product' : 'products'}</span>
    </span>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3.5">
      <h2
        id={id}
        className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-w-10 border px-2.5 py-1.5 text-xs tabular-nums transition-colors',
        pressed
          ? 'border-foreground bg-foreground text-background'
          : 'border-border hover:border-foreground/60',
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

function OptionButton({
  pressed,
  count,
  onClick,
  children,
}: {
  pressed: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 text-left text-sm transition-colors',
        pressed ? 'text-foreground' : 'text-foreground/75 hover:text-foreground',
        focusRing,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-4 shrink-0 place-items-center border transition-colors',
          pressed ? 'border-foreground bg-foreground text-background' : 'border-foreground/30',
        )}
      >
        {pressed ? <CheckIcon className="size-3" strokeWidth={2.5} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {count === undefined ? null : (
        <ProductCount count={count} className="text-xs text-muted-foreground tabular-nums" />
      )}
    </button>
  );
}

function CategoryFilter({
  selected,
  categories,
  counts,
  onSelect,
}: {
  selected: string | undefined;
  categories: readonly CategoryNode[] | undefined;
  counts: ProductFacets['categories'];
  onSelect: (slug: string | undefined) => void;
}) {
  // The tree comes from /categories; the numbers come from the facets, so they follow the
  // current gender and search. A group with nothing in scope is not offered.
  const countBySlug = new Map(counts.map((category) => [category.slug, category.count]));
  const groups = (categories ?? [])
    .map((group) => {
      const children = group.children
        .map((child) => ({ ...child, count: countBySlug.get(child.slug) ?? 0 }))
        .filter((child) => child.count > 0);
      const count =
        (countBySlug.get(group.slug) ?? 0) + children.reduce((sum, child) => sum + child.count, 0);
      return { ...group, children, count };
    })
    .filter((group) => group.count > 0);

  const link = (slug: string | undefined, label: string, count?: number, nested = false) => {
    const active = selected === slug;
    return (
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          onSelect(slug);
        }}
        className={cn(
          'flex w-full items-baseline justify-between gap-3 text-left transition-colors',
          nested ? 'text-[13px]' : 'text-sm',
          active
            ? 'font-medium text-foreground underline underline-offset-4'
            : 'text-foreground/75 hover:text-foreground',
          focusRing,
        )}
      >
        <span>{label}</span>
        {count === undefined ? null : (
          <ProductCount
            count={count}
            className="text-xs font-normal text-muted-foreground tabular-nums"
          />
        )}
      </button>
    );
  };

  return (
    <FilterSection title="Category">
      {categories === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col gap-2">
          <li>{link(undefined, 'All categories')}</li>
          {groups.map((group) => (
            <li key={group.slug} className="flex flex-col gap-1.5">
              {link(group.slug, group.name, group.count)}
              {group.children.length > 0 ? (
                <ul className="ml-3 flex flex-col gap-1.5 border-l border-border pl-3">
                  {group.children.map((child) => (
                    <li key={child.slug}>{link(child.slug, child.name, child.count, true)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </FilterSection>
  );
}

function BrandFilter({
  brands,
  selected,
  onToggle,
}: {
  brands: ProductFacets['brands'];
  selected: readonly string[];
  onToggle: (brand: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Selected brands stay visible even when the list is collapsed.
  const visible = expanded
    ? brands
    : brands.filter((brand, index) => index < BRAND_PREVIEW || selected.includes(brand.value));

  return (
    <FilterSection title="Brand">
      <ul className="flex flex-col gap-1.5">
        {visible.map((brand) => (
          <li key={brand.value}>
            <OptionButton
              pressed={selected.includes(brand.value)}
              count={brand.count}
              onClick={() => {
                onToggle(brand.value);
              }}
            >
              <span className="truncate">{brand.value}</span>
            </OptionButton>
          </li>
        ))}
      </ul>
      {brands.length > BRAND_PREVIEW ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
          className={cn(
            'self-start border-b border-foreground/30 pb-0.5 text-[10px] font-semibold tracking-[0.2em] uppercase hover:border-foreground',
            focusRing,
          )}
        >
          {expanded ? 'Show fewer' : `Show all ${String(brands.length)}`}
        </button>
      ) : null}
    </FilterSection>
  );
}

function PriceFilter({
  min,
  max,
  range,
  currency,
  onApply,
}: {
  min: number | undefined;
  max: number | undefined;
  range: ProductFacets['price'];
  currency: string;
  onApply: (min: number | undefined, max: number | undefined) => void;
}) {
  const minId = useId();
  const maxId = useId();

  const parse = (value: FormDataEntryValue | null): number | undefined => {
    const text = typeof value === 'string' ? value.trim() : '';
    return /^\d{1,8}$/.test(text) ? Number(text) : undefined;
  };

  return (
    <FilterSection title="Price">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onApply(parse(data.get('min')), parse(data.get('max')));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={minId} className="text-xs text-muted-foreground">
              Min (৳)
            </label>
            <Input
              id={minId}
              name="min"
              inputMode="numeric"
              pattern="\d*"
              defaultValue={min ?? ''}
              placeholder={range ? String(Math.floor(range.minMinor / 100)) : ''}
              className="rounded-none tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={maxId} className="text-xs text-muted-foreground">
              Max (৳)
            </label>
            <Input
              id={maxId}
              name="max"
              inputMode="numeric"
              pattern="\d*"
              defaultValue={max ?? ''}
              placeholder={range ? String(Math.ceil(range.maxMinor / 100)) : ''}
              className="rounded-none tabular-nums"
            />
          </div>
        </div>
        {range ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatMoney(range.minMinor, currency)} – {formatMoney(range.maxMinor, currency)} in
            this selection
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" variant="outline" size="sm" className="rounded-none">
            Apply
          </Button>
          {min !== undefined || max !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none"
              onClick={() => {
                onApply(undefined, undefined);
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
      </form>
    </FilterSection>
  );
}
