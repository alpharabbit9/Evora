/**
 * Content and art direction for the home-page campaign hero. Everything a campaign change
 * touches lives here; the slider, slide and motion code read it and never hard-code copy,
 * image paths or positions.
 *
 * To swap a model, add a cut-out under `public/images/Hero/` and point `image.src` at it,
 * update `width`/`height` to the file's pixel size, and retune `figure` so the head and shoes
 * stay inside the hero. Cut-outs are transparent images with the figure roughly centred and
 * touching the bottom edge, as the current three are. Ship them as WebP with alpha, no more
 * than about 1600px tall and under 300KB (the current ones were exported from the PNG
 * masters beside them at quality 86, alpha quality 100), so the image optimiser's first,
 * uncached request for each size stays cheap.
 */

/** Mobile (< 768px), tablet (768–1023px) and desktop (≥ 1024px) values. */
export type HeroResponsive<T> = { base: T; md: T; lg: T };

export type HeroCta = {
  label: string;
  href: string;
};

export type HeroFigurePlacement = {
  /** Horizontal centre of the image box, as a percentage of the hero width. */
  x: number;
  /** Height of the image box, as a percentage of the hero height. Width follows the PNG. */
  height: number;
  /** Gap between the image box and the bottom of the hero, as a percentage of its height. */
  bottom: number;
};

export type HeroHeadline = {
  /** Letters only when `font` is `display`: the demo font watermarks digits and symbols. */
  text: string;
  /** `display` is Brigends Expanded (capitals only); `serif` is Playfair Display. */
  font: 'display' | 'serif';
  /** Letter spacing, in em. */
  tracking: number;
  /**
   * Width of `text` in em with no letter spacing, as the sum of each letter measured on its
   * own (`CanvasRenderingContext2D.measureText`): every letter sits in its own reveal mask,
   * so kerning pairs never apply. The fluid font size is derived from it; re-measure if
   * `text` or `font` changes.
   */
  measure: number;
  /** Share of the gutter-to-gutter width the word may span (0–1). */
  span: number;
  /** Ceiling on the font size as a percentage of the hero height, for short, wide screens. */
  maxSize: HeroResponsive<number>;
  /** Vertical centre of the word, as a percentage of the hero height. */
  y: HeroResponsive<number>;
};

export type HeroSlide = {
  id: string;
  /** Short name used in accessible labels ("Slide 1 of 3: Heritage collection"). */
  label: string;
  /** Editorial run of words across the top left. */
  eyebrow: string[];
  /** Brand statement at the top right (tablet and up), one entry per line. */
  statement: string[];
  /** The slide's heading, one entry per line. */
  title: string[];
  headline: HeroHeadline;
  primaryCta: HeroCta;
  secondaryCta?: HeroCta;
  /** Small label above the slide controls (tablet and up), one entry per line. */
  collection?: string[];
  /**
   * Tone for the oversized word and the accent rule. Both map to theme tokens that have a
   * light and a dark value, so contrast holds in either mode.
   */
  accent: 'foreground' | 'muted';
  image: {
    src: string;
    width: number;
    height: number;
    alt: string;
  };
  figure: HeroResponsive<HeroFigurePlacement>;
  /** Where the shoes meet the floor, as fractions of the image box, for the contact shadow. */
  ground: { x: number; width: number };
  /** Centre of the soft backdrop light, as percentages of the hero. */
  light: { x: number; y: number };
};

/** Seconds each slide stays on screen before the slider advances. */
export const HERO_AUTOPLAY_SECONDS = 8;

/**
 * Each slide's oversized word: one word from its own story, in Brigends Expanded, spanning
 * the gutters behind the model. (It was the brand name on every slide until Phase 3; with
 * the header wordmark directly above, the name read twice within 400px.) The model may hide
 * at most one whole letter, so the word still reads; `e2e/tests/hero.spec.ts` checks that
 * against the model's alpha at phone and desktop widths. Retune `figure` or `y` if it fails.
 */
const HEADLINE_SETTING = {
  font: 'display',
  tracking: -0.005,
  span: 1,
  maxSize: { base: 20, md: 22, lg: 34 },
  y: { base: 35, md: 41, lg: 45 },
} as const satisfies Omit<HeroHeadline, 'text' | 'measure'>;

/**
 * `measure` comes from canvas `measureText` on Brigends Expanded, letter by letter (see
 * `HeroHeadline`). `phoneY` overrides the word's height on phones, where letters are about a
 * third as wide as the coat: there the word sits at head height instead, so only the head
 * crosses it.
 */
function storyHeadline(text: string, measure: number, phoneY?: number): HeroHeadline {
  const y = { ...HEADLINE_SETTING.y, ...(phoneY === undefined ? {} : { base: phoneY }) };
  return { ...HEADLINE_SETTING, text, measure, y };
}

const STORY_HEADLINES = {
  heritage: storyHeadline('HERITAGE', 7.315, 24),
  tailored: storyHeadline('TAILORED', 7.357),
  essential: storyHeadline('ESSENTIAL', 8.327, 24),
} as const;

export const HERO_SLIDES: readonly HeroSlide[] = [
  {
    id: 'heritage',
    label: 'Heritage collection',
    eyebrow: ['Menswear', 'Heritage', 'Autumn / Winter'],
    statement: ['Timeless style', 'for modern men'],
    title: ['English heritage.', 'Reimagined for today.'],
    headline: STORY_HEADLINES.heritage,
    primaryCta: { label: 'Shop now', href: '/collections/men' },
    secondaryCta: { label: 'Explore collection', href: '/collections/new' },
    collection: ['New collection', '2026'],
    accent: 'foreground',
    image: {
      src: '/images/Hero/hero1.webp',
      width: 1205,
      height: 1306,
      alt: 'Man in a charcoal herringbone three-piece suit, long wool overcoat and flat cap, walking',
    },
    figure: {
      base: { x: 54, height: 60, bottom: 20 },
      md: { x: 54, height: 63, bottom: 17 },
      lg: { x: 54, height: 91, bottom: 2.5 },
    },
    ground: { x: 0.56, width: 0.64 },
    light: { x: 54, y: 46 },
  },
  {
    id: 'modern-elegance',
    label: 'Modern elegance',
    eyebrow: ['Womenswear', 'Tailoring', 'Outerwear'],
    statement: ['Quiet tailoring', 'for modern women'],
    title: ['Modern silhouettes.', 'Timeless confidence.'],
    headline: STORY_HEADLINES.tailored,
    primaryCta: { label: 'Discover the collection', href: '/collections/women' },
    collection: ['Modern', 'elegance'],
    accent: 'foreground',
    image: {
      src: '/images/Hero/hero2.webp',
      width: 1536,
      height: 1024,
      alt: 'Woman in a long black wool coat and wide trousers, walking',
    },
    figure: {
      base: { x: 50, height: 50, bottom: 21 },
      md: { x: 50, height: 55, bottom: 18 },
      lg: { x: 47, height: 86, bottom: 2.5 },
    },
    ground: { x: 0.53, width: 0.52 },
    light: { x: 49, y: 44 },
  },
  {
    id: 'new-season',
    label: 'New season',
    eyebrow: ['New season', 'Essentials', 'Ready to wear'],
    statement: ['Considered pieces', 'for a deliberate everyday'],
    title: ['A new perspective', 'on everyday luxury.'],
    headline: STORY_HEADLINES.essential,
    primaryCta: { label: 'View collection', href: '/collections/new' },
    collection: ['New season', '2026'],
    accent: 'foreground',
    image: {
      src: '/images/Hero/hero3.webp',
      width: 1024,
      height: 1536,
      alt: 'Man in a flat cap, white shirt and tie, herringbone three-piece suit and long overcoat, standing',
    },
    figure: {
      base: { x: 50, height: 62, bottom: 20 },
      md: { x: 53, height: 65, bottom: 17 },
      lg: { x: 56, height: 93, bottom: 2 },
    },
    ground: { x: 0.5, width: 0.36 },
    light: { x: 56, y: 44 },
  },
];

/**
 * `sizes` for a figure, so the browser picks a srcset candidate close to the rendered width.
 * The hero is about 0.6× the viewport width tall on desktop (it is capped at that ratio) and
 * roughly 1.3× / 1.9× the width on portrait tablets and phones.
 */
export function figureSizes({ image, figure }: HeroSlide): string {
  const aspect = image.width / image.height;
  const vw = (heightPercent: number, heroHeightPerWidth: number) =>
    Math.ceil(heightPercent * heroHeightPerWidth * aspect);
  return [
    `(min-width: 1024px) ${String(vw(figure.lg.height, 0.6))}vw`,
    `(min-width: 768px) ${String(vw(figure.md.height, 1.3))}vw`,
    `${String(vw(figure.base.height, 1.9))}vw`,
  ].join(', ');
}
