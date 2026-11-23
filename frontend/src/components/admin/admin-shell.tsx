'use client';

import {
  BarChart3Icon,
  BoxesIcon,
  HistoryIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  ScrollTextIcon,
  SettingsIcon,
  TicketPercentIcon,
  PackageIcon,
  ReceiptTextIcon,
  TagsIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { Wordmark } from '@/components/layout/brand';
import { cn } from '@/lib/utils';

const NAV: readonly { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: '/admin', label: 'Overview', icon: BarChart3Icon, exact: true },
  { href: '/admin/orders', label: 'Orders', icon: ReceiptTextIcon },
  { href: '/admin/products', label: 'Products', icon: PackageIcon },
  { href: '/admin/categories', label: 'Categories', icon: TagsIcon },
  { href: '/admin/inventory', label: 'Inventory', icon: BoxesIcon, exact: true },
  { href: '/admin/inventory/movements', label: 'Stock history', icon: HistoryIcon },
  { href: '/admin/customers', label: 'Customers', icon: UsersIcon },
  { href: '/admin/coupons', label: 'Coupons', icon: TicketPercentIcon },
  { href: '/admin/jobs', label: 'Emails & jobs', icon: MailIcon },
  { href: '/admin/assistant', label: 'Assistant chats', icon: MessageCircleIcon },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollTextIcon },
  { href: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * The dashboard's chrome: skip link, navigation and the `<main>` landmark, without the store's
 * header and footer (architecture.md §6). A sidebar on a wide screen, a scrolling row above the
 * content on a narrow one. Rendered only after `AdminOnly` has passed.
 */
export function AdminShell({
  userEmail,
  children,
}: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="flex flex-col gap-4 border-b border-border bg-card px-4 py-4 lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
        <div className="flex items-baseline gap-2">
          <Wordmark className="text-xl/none" />
          <span className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
            Admin
          </span>
        </div>

        <nav aria-label="Admin" className="-mx-1 overflow-x-auto lg:mx-0 lg:overflow-visible">
          <ul className="flex gap-1 px-1 lg:flex-col lg:px-0">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);

              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors',
                      focusRing,
                      active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center justify-between gap-3 lg:mt-auto lg:flex-col lg:items-start">
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="truncate" title={userEmail}>
              {userEmail}
            </p>
            <Link
              href="/"
              className={cn('underline underline-offset-4 hover:text-foreground', focusRing)}
            >
              View store
            </Link>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main
        id="admin-content"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col p-4 focus:outline-none sm:p-6 lg:p-10"
      >
        {children}
      </main>
    </div>
  );
}
