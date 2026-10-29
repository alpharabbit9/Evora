import { cn } from '@/lib/utils';

/**
 * Swatch fills for the colour names the catalog uses. The name is the source's own label
 * and is always shown or announced alongside the swatch; the fill is decoration, so an
 * unknown name falls back to a neutral tone rather than a guess.
 */
const SWATCHES: Record<string, string> = {
  black: '#121212',
  charcoal: '#36454f',
  grey: '#7d7d7d',
  'grey melange': '#a3a3a3',
  steel: '#71797e',
  silver: '#c0c0c0',
  'navy blue': '#1f2a44',
  brown: '#6b4226',
  'coffee brown': '#4b3621',
  olive: '#556b2f',
  maroon: '#5c1a1b',
  burgundy: '#6d1a36',
};

export function swatchFill(color: string): string {
  return SWATCHES[color.toLowerCase()] ?? '#9a9a9a';
}

export function ColorSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-3 rounded-full ring-1 ring-foreground/20', className)}
      style={{ backgroundColor: swatchFill(color) }}
    />
  );
}
