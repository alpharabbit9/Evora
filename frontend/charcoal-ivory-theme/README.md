# Charcoal & Ivory — Reusable Next.js Theme

A warm, minimal neutral theme built from two brand colors — **Charcoal `#2A2529`**
and **Pale Ivory `#F3F0E7`** — expanded into a full design-token system with a
derived dark mode, typography, and UI component styles modelled on the
storefront reference.

Drop it into any project. Works with **Tailwind v4** or **plain CSS** (React,
Next.js, Vue, Svelte, vanilla — anything).

---

## What's inside

```
theme/
├── palette.png            # the color palette poster
├── preview.html           # open in a browser to see everything live (+ dark toggle)
├── tokens.js              # all tokens as JS/TS (charts, canvas, RN, theme providers)
├── fonts/
│   └── Brigends_Expanded.otf   # display font (see "Fonts" note below)
├── styles/
│   ├── tokens.css         # CORE: all CSS variables — colors, radius, shadow, spacing
│   ├── typography.css     # @font-face + type scale + base element styles
│   ├── components.css     # .btn .card .badge .input .chip .product … (framework-agnostic)
│   └── index.css          # one-import entry for NON-Tailwind projects
└── tailwind/
    └── theme.css          # Tailwind v4 entry: maps tokens → utilities
```

`tokens.css` is the single source of truth. Everything else references it, so
changing a color in one place updates the whole system.

---

## Integration

### Option A — Tailwind v4 (your chosen setup)

In your app's `globals.css`:

```css
@import "tailwindcss";
@import "../theme/tailwind/theme.css";      /* colors, fonts, radius, shadows → utilities */
@import "../theme/styles/components.css";    /* optional: .btn .card .badge … classes */
```

> Keep `@import "tailwindcss";` as the **first** line.
> Adjust the `../theme/...` path to wherever you place the folder.

You now get utilities wired to the theme:

```html
<div class="bg-background text-foreground">
  <h1 class="font-display">Elevate Your Style</h1>
  <button class="bg-primary text-primary-foreground rounded-full px-6 py-3">Shop Now</button>
  <p class="text-muted-foreground">Warm neutral, quiet contrast.</p>
  <span class="bg-destructive text-destructive-foreground rounded-full px-2 py-1">SALE</span>
  <div class="bg-sand-200 border border-border rounded-lg shadow-md">card</div>
</div>
```

Available color utilities: `background foreground card card-foreground popover
popover-foreground primary primary-foreground secondary secondary-foreground
muted muted-foreground accent accent-foreground destructive
destructive-foreground success success-foreground border input ring`, plus the
raw scale `charcoal ivory sand-50 … sand-950`.
Fonts: `font-sans` `font-display` `font-mono`.

### Option B — Plain CSS / any framework (no Tailwind)

```css
/* in your global stylesheet */
@import "../theme/styles/index.css";
```
or in a JS/React entry:
```js
import "../theme/styles/index.css";
```

This gives you the CSS variables **and** the ready-made component classes
(`.btn`, `.card`, `.badge`, `.input`, `.chip`, `.product`, `.promo`, `.feature`).

```html
<button class="btn btn-lg">Shop Now</button>
<button class="btn btn-outline">Watch Lookbook</button>
<article class="product">
  <div class="product-media"><span class="badge badge-sale">SALE</span></div>
  <div class="product-title">Linen Blazer</div>
  <div class="price"><span class="price-now">$69</span><span class="price-old">$89</span></div>
</article>
```

### Option C — tokens in JS

```js
import { brand, sand, semantic, themes } from "../theme/tokens";
const bg = themes.dark.background;   // "#1a171a"
```

---

## Dark mode

Class-based, compatible with `next-themes`. Add `class="dark"` to `<html>`:

```tsx
// app/layout.tsx  (with next-themes)
import { ThemeProvider } from "next-themes";

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`tokens.css` also ships an optional `prefers-color-scheme` fallback (so it works
even without a toggle). Delete that `@media` block if you drive theming purely
with the class.

---

## Fonts

- **Display / headings:** `Brigends Expanded` (self-hosted `.otf`), set as
  `--font-display` / `font-display`. It's an all-caps expanded grotesque.
- **Body:** a system sans stack by default (no network request). To match the
  reference more closely, uncomment the Inter import at the top of
  `typography.css` and put `"Inter"` first in `--font-body`.

### ⚠ The supplied font file is a DEMO version

`Brigends_Expanded.otf` is a trial release from **Multype Studio**. Letters
(A–Z) and basic punctuation render perfectly, but **digits `0–9` and symbols
(`& - / @ # : %`) render a small "DEMO VERSION — purchase full version"
watermark.**

How this theme handles it:

1. **Headings with words only** → use `font-display` freely ("Elevate Your Style").
2. **Headings containing numbers/symbols** → wrap that part in `.display-num`
   so it falls back to the body font (no watermark):
   ```html
   <h2>Spring Sale <span class="display-num">50% OFF</span></h2>
   ```
3. **For commercial use** (recommended for client/production work): buy the full
   license at <https://multypestudio.com> and replace `fonts/Brigends_Expanded.otf`
   with the licensed file. Keep the family name `"Brigends Expanded"` → **zero
   code changes needed.**

I did not alter or strip the watermark (that would bypass the font's license).

---

## Token reference (quick)

| Role | Light | Dark |
|---|---|---|
| background | `#F3F0E7` | `#1A171A` |
| foreground | `#2A2529` | `#F3F0E7` |
| card | `#FBFAF5` | `#2A2529` |
| primary | `#2A2529` | `#F3F0E7` |
| secondary / muted | `#E8E3D7` | `#38322C` |
| muted-foreground | `#6E665A` | `#C3BAA8` |
| accent | `#DAD3C4` | `#524B42` |
| destructive | `#B24A32` | `#D9664B` |
| border / input | `#DED6C7` | `#38322C` |
| ring | `#2A2529` | `#C3BAA8` |

Radius: `--radius-sm 8px` · `md 12px` · `lg 16px` · `xl 24px` · `full pill`.
Shadows: `--shadow-xs … --shadow-xl` (soft, warm-tinted).
All text pairs meet **WCAG AA** (most AAA).

---

## Customize

Change the brand anywhere by editing `styles/tokens.css`:

```css
:root {
  --brand-charcoal: #2a2529;   /* ← your dark  */
  --brand-ivory:    #f3f0e7;   /* ← your light */
  --radius:         0.75rem;   /* global roundness */
}
```

Semantic tokens reference the scale, so adjusting `--sand-*` or the brand
anchors cascades through every component automatically.
