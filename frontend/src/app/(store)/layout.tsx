import { StorefrontShell } from '@/components/layout/storefront-shell';

/**
 * Every customer-facing page lives in this group and gets the navbar and footer from here,
 * once. A route group adds no URL segment: `(store)/account/page.tsx` is still `/account`.
 *
 * Kept outside on purpose: `/auth` (with `/sign-in` and `/sign-up`, which redirect to it)
 * has its own full-bleed layout, and the admin dashboard will have its own shell.
 */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
