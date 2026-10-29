'use client';

import { SearchIcon, XIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';

import { cn } from '@/lib/utils';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The search field on `/search`. Submitting replaces the query and drops every filter and
 * the page number: a new search starts from the whole catalog. The field is keyed by the
 * current `q`, so Back/Forward through searches updates what it shows.
 */
export function SearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const inputId = useId();

  return (
    <form
      role="search"
      key={q}
      className="mt-8 flex max-w-2xl items-center gap-3 border-b border-foreground/40 pb-2 focus-within:border-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get('q') ?? '').trim();
        router.push(value ? `/search?q=${encodeURIComponent(value.slice(0, 100))}` : '/search');
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
        defaultValue={q}
        maxLength={100}
        placeholder="Search jackets, boots, black denim…"
        autoComplete="off"
        enterKeyHint="search"
        className="min-w-0 flex-1 bg-transparent py-2 text-lg outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            router.push('/search');
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
  );
}
