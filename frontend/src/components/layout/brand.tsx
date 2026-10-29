import Link from 'next/link';

import { cn } from '@/lib/utils';

type WordmarkProps = Omit<React.ComponentProps<typeof Link>, 'href'> & {
  href?: string;
};

/**
 * The EVORA wordmark, set in the theme's display face. Letters only, which is what keeps it
 * clear of the demo font's digit/symbol watermark. Size and colour come from the caller.
 *
 * Pass the size with its line height (`text-[2rem]/none`): `cn` (tailwind-merge) drops the
 * `leading-none` below whenever a later class sets the font size.
 */
export function Wordmark({ className, href = '/', ...props }: WordmarkProps) {
  return (
    <Link
      href={href}
      aria-label="EVORA home"
      className={cn(
        'font-display leading-none tracking-[0.02em] whitespace-nowrap text-current',
        className,
      )}
      {...props}
    >
      EVORA
    </Link>
  );
}
