import type { Metadata } from 'next';
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google';
import localFont from 'next/font/local';

import { AppProviders } from '@/components/providers/app-providers';
import { SITE_URL } from '@/lib/env';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from '@/lib/site';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Headings use the regular weight, with medium in a few places; 600 and 700 were never set, so
// they are not downloaded. Add a weight here before using it, or the browser fakes a bold.
const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['400', '500'],
});

// Display face, read from the Charcoal & Ivory theme folder. The weight range stops the
// browser from synthesising a faux bold when a heavier class is applied: the single file is
// already heavy.
const brigends = localFont({
  src: '../../charcoal-ivory-theme/fonts/Brigends_Expanded.otf',
  variable: '--font-brigends',
  weight: '400 900',
  display: 'swap',
});

export const metadata: Metadata = {
  // Resolves the relative URLs below and the Open Graph image file (`opengraph-image.jpg`,
  // captured from the home page hero) into absolute ones, which link previews require.
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s — EVORA',
  },
  description: SITE_DESCRIPTION,
  openGraph: { siteName: SITE_NAME, type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `suppressHydrationWarning` is required by next-themes: it sets the theme class on
    // this element before React hydrates, replacing `light` with `dark` for a visitor who chose
    // it. `light` is rendered here so the page is light if that script never runs: without a
    // theme class, the theme's tokens follow a dark OS setting.
    <html
      lang="en"
      className={`light ${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${brigends.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* `min-h-dvh`, not `min-h-full`: lenis.css sets `html { height: auto }`, which
          would make a percentage min-height here resolve against nothing. */}
      <body className="flex min-h-dvh flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
