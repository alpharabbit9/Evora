'use client';

import Link from 'next/link';

import { useSession } from '@/lib/auth-client';

import { SIGNED_IN_LINKS, SIGNED_OUT_LINKS } from './nav-links';

/**
 * The account links for whoever is looking: "Sign in" and "Create account" for a visitor, "My
 * account" for a customer. It decides which links to show and nothing more: `/account` asks the
 * API itself before rendering anything private. Until the session read settles, the signed-out
 * links are shown, as in the header.
 *
 * A small client island, so the footer around it stays a Server Component.
 */
export function AccountLinks({
  className,
  linkClassName,
}: {
  className?: string;
  linkClassName?: string;
}) {
  const { data: session } = useSession();
  const links = session ? SIGNED_IN_LINKS : SIGNED_OUT_LINKS;

  return (
    <ul className={className}>
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href} className={linkClassName}>
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
