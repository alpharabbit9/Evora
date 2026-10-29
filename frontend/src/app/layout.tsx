import type { Metadata } from 'next';
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google';
import localFont from 'next/font/local';

import { AppProviders } from '@/components/providers/app-providers';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
  title: {
    default: 'EVORA — Modern essentials',
    template: '%s — EVORA',
  },
  description: 'Considered clothing and objects for a slower, more deliberate everyday.',
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
