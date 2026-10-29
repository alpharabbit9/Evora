import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/**
 * The chrome every customer-facing page shares: skip link, header, the `<main>` landmark and
 * footer. Pages render inside `<main>` and must not add their own.
 *
 * Mounted once by `app/(store)/layout.tsx`. The root `app/not-found.tsx` mounts it directly,
 * because an unmatched URL renders under the root layout, outside every route group. Auth
 * (`/auth`, `/sign-in`, `/sign-up`) and the admin dashboard sit outside `(store)` and
 * deliberately render without it.
 */
export function StorefrontShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
