'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SearchIcon, XIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { ProductImage } from '@/components/catalog/product-image';
import { IN_PLACE_NAVIGATION } from '@/components/layout/page-transition';
import { MIN_SUGGESTION_LENGTH, catalogKeys, fetchSearchSuggestions } from '@/lib/catalog/api';
import { formatPriceRange } from '@/lib/money';
import { cn } from '@/lib/utils';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Long enough that typing a word is one request, short enough to feel immediate. */
const SUGGEST_DEBOUNCE_MS = 250;

const MAX_QUERY_LENGTH = 100;

function searchHref(value: string): string {
  const q = value.trim().slice(0, MAX_QUERY_LENGTH);
  return q ? `/search?q=${encodeURIComponent(q)}` : '/search';
}

interface Option {
  readonly id: string;
  readonly href: string;
  /** A new search stays on `/search`; a product or a shelf is a different page. */
  readonly inPlace: boolean;
  readonly content: React.ReactNode;
}

/**
 * The search field on `/search`, with suggestions as you type: matching shelves, the first
 * products the results page would list (the API runs the same query), and a link to all of
 * them. It is an ARIA combobox: arrow keys move through the options without leaving the field,
 * Enter opens the highlighted one or searches for what was typed, Escape closes the list.
 *
 * Submitting replaces the query and drops every filter and the page number: a new search starts
 * from the whole catalog. The form is keyed by the current `q`, so Back/Forward through searches
 * updates what it shows. A new search is an in-place navigation: the results change, the page
 * does not fade.
 */
export function SearchBox() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';

  return <SearchForm key={q} initial={q} />;
}

function SearchForm({ initial }: { initial: string }) {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();

  const [value, setValue] = useState(initial);
  const [settled, setSettled] = useState(initial.trim());
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value.trim());
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  const term = settled.slice(0, MAX_QUERY_LENGTH);
  const suggestions = useQuery({
    queryKey: catalogKeys.suggestions(term),
    queryFn: ({ signal }) => fetchSearchSuggestions(term, signal),
    enabled: open && term.length >= MIN_SUGGESTION_LENGTH,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const data = term.length >= MIN_SUGGESTION_LENGTH ? suggestions.data : undefined;

  const options: Option[] = data
    ? [
        ...data.categories.map((category) => ({
          id: `${listId}-category-${category.slug}`,
          href: `/shop?category=${encodeURIComponent(category.slug)}`,
          inPlace: false,
          content: (
            <span className="flex items-baseline justify-between gap-4">
              <span>{category.name}</span>
              <span className="text-xs text-muted-foreground">
                {category.parentName ? `in ${category.parentName}` : 'Shop all'}
              </span>
            </span>
          ),
        })),
        ...data.products.map((product) => ({
          id: `${listId}-product-${product.slug}`,
          href: `/products/${product.slug}`,
          inPlace: false,
          content: (
            <span className="flex items-center gap-3">
              <span className="relative aspect-[3/4] w-10 shrink-0 overflow-hidden bg-muted">
                <ProductImage image={product.image} sizes="40px" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{product.name}</span>
                {product.brand ? (
                  <span className="block text-xs text-muted-foreground">{product.brand}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                {formatPriceRange(product.priceMinor, product.maxPriceMinor, product.currency)}
              </span>
            </span>
          ),
        })),
        ...(data.totalProducts > 0
          ? [
              {
                id: `${listId}-all`,
                href: searchHref(term),
                inPlace: true,
                content: (
                  <span className="text-[10px] font-semibold tracking-[0.2em] uppercase">
                    See all {data.totalProducts} results for “{term}”
                  </span>
                ),
              },
            ]
          : []),
      ]
    : [];

  const expanded = open && term.length >= MIN_SUGGESTION_LENGTH && data !== undefined;
  const activeOption = expanded ? options[active] : undefined;

  const go = (href: string, inPlace: boolean) => {
    setOpen(false);
    setActive(-1);
    router.push(href, inPlace ? { transitionTypes: [IN_PLACE_NAVIGATION] } : undefined);
  };

  const status = !expanded
    ? ''
    : data.totalProducts === 0 && data.categories.length === 0
      ? `No matches for ${term}`
      : `${String(options.length)} suggestions available`;

  return (
    <div className="relative mt-8 max-w-2xl">
      <form
        role="search"
        className="flex items-center gap-3 border-b border-foreground/40 pb-2 focus-within:border-foreground"
        onSubmit={(event) => {
          event.preventDefault();
          if (activeOption) {
            go(activeOption.href, activeOption.inPlace);
            return;
          }
          go(searchHref(value), true);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search products
        </label>
        <SearchIcon
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <input
          id={inputId}
          name="q"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={activeOption?.id}
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="Search jackets, boots, black denim…"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && expanded) {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
              return;
            }

            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setOpen(true);
            if (options.length === 0) return;

            const step = event.key === 'ArrowDown' ? 1 : -1;
            // -1 is "back in the field": the cycle runs field, options..., field.
            setActive((current) => {
              const next = current + step;
              if (next >= options.length) return -1;
              if (next < -1) return options.length - 1;
              return next;
            });
          }}
          className="min-w-0 flex-1 bg-transparent py-2 text-lg outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden"
        />
        {initial ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              go('/search', true);
            }}
            className={cn(
              'grid size-8 place-items-center text-muted-foreground hover:text-foreground',
              focusRing,
            )}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="submit"
          className={cn(
            'text-[10px] font-semibold tracking-[0.2em] uppercase hover:opacity-70',
            focusRing,
          )}
        >
          Search
        </button>
      </form>

      {/* Mounted always so `aria-controls` names an element; empty and hidden while closed. */}
      <ul
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!expanded || options.length === 0}
        className={cn(
          'absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto border border-border bg-background py-1 shadow-lg',
          suggestions.isPlaceholderData && 'opacity-70',
        )}
      >
        {expanded
          ? options.map((option, index) => (
              <li
                key={option.id}
                id={option.id}
                role="option"
                aria-selected={index === active}
                // Keep focus in the field, so its blur does not close the list before the click.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  go(option.href, option.inPlace);
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                className={cn(
                  'cursor-pointer px-4 py-2.5 text-sm',
                  index === active && 'bg-muted',
                  option.inPlace && 'border-t border-border',
                )}
              >
                {option.content}
              </li>
            ))
          : null}
      </ul>

      <p role="status" className="sr-only">
        {status}
      </p>
      {expanded && options.length === 0 ? (
        <p className="absolute inset-x-0 top-full z-30 mt-2 border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          No matches for “{term}”. Try a different word.
        </p>
      ) : null}
    </div>
  );
}
