'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { IN_PLACE_NAVIGATION } from '@/components/layout/page-transition';

export type ListParamChanges = Record<string, string | number | undefined>;

/**
 * An admin list's search, filters and page, kept in the URL so a filtered view survives Back,
 * a refresh and being shared with a colleague. Needs a `<Suspense>` above it (`useSearchParams`
 * under `cacheComponents`), which every admin page has around its gate.
 */
export function useListParams() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /** Anything but a positive integer reads as page 1, so a hand-edited URL cannot 400. */
  const parsedPage = Number(searchParams.get('page'));
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const hrefWith = (changes: ListParamChanges): string => {
    const next = new URLSearchParams(searchParams.toString());

    // Any change of filter starts again from the first page; a change of page says so itself.
    if (!('page' in changes)) next.delete('page');

    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }

    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return {
    page,
    get: (key: string) => searchParams.get(key) ?? undefined,
    /** The value only if it is one the API accepts; anything else is treated as no filter. */
    getOneOf: <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
      const value = searchParams.get(key);
      return allowed.find((candidate) => candidate === value);
    },
    hrefWith,
    set: (changes: ListParamChanges) => {
      router.replace(hrefWith(changes), {
        scroll: false,
        transitionTypes: [IN_PLACE_NAVIGATION],
      });
    },
  };
}

export type ListParams = ReturnType<typeof useListParams>;
