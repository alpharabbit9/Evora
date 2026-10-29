'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';

import { SmoothScrollProvider } from '@/components/providers/smooth-scroll-provider';
import { Toaster } from '@/components/ui/sonner';
import { isRetryableApiError } from '@/lib/api-error';

/**
 * The client-side context the shared components rely on: the query cache behind
 * `QueryState`, the theme the toaster and tokens read, the toast outlet `useAsyncAction`
 * posts to, and the Lenis instance `useLenis` reads. Without this mounted, those helpers would look like they work
 * and quietly do nothing.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Short, not zero: enough to stop a remount refetching, short enough that price
        // and stock stay close to the server's truth. Checkout reads authoritative data
        // from the server anyway (architecture.md §10).
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry only what could plausibly succeed on a second try.
        retry: (failureCount, error) => failureCount < 2 && isRetryableApiError(error),
      },
      mutations: {
        // Never retried by default: a repeated mutation needs an idempotency key, which
        // the call site owns.
        retry: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  // One client per browser session, created inside React so a server render cannot share
  // one cache (and one user's data) between requests.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Light until the visitor picks dark with ThemeToggle; the OS setting is ignored and
          the choice is kept in localStorage. `disableTransitionOnChange` makes colours switch
          at once, so the theme reveal never shows a control still fading from the old one. */}
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
        {/* Fixed-position outlet: kept outside the scroller so toasts never ride it. */}
        <Toaster />
      </ThemeProvider>
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
