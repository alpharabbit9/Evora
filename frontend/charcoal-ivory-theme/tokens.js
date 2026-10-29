/* ============================================================================
   CHARCOAL & IVORY — Tokens as JS/TS (for JS access: charts, canvas, RN, etc.)
   ----------------------------------------------------------------------------
   Framework-agnostic. Semantic tokens list light + dark values so you can pick
   based on the active theme in code.

       import { brand, sand, semantic, radius, shadow } from "../theme/tokens";
       const bg = semantic.background.dark;   // "#1a171a"
   ============================================================================ */

export const brand = {
  charcoal: "#2a2529",
  ivory: "#f3f0e7",
};

export const sand = {
  50: "#faf8f3",
  100: "#f3f0e7",
  200: "#e8e3d7",
  300: "#dad3c4",
  400: "#c3baa8",
  500: "#9c9484",
  600: "#6e665a",
  700: "#524b42",
  800: "#38322c",
  900: "#2a2529",
  950: "#1a171a",
};

/** Each token: { light, dark } */
export const semantic = {
  background:             { light: "#f3f0e7", dark: "#1a171a" },
  foreground:             { light: "#2a2529", dark: "#f3f0e7" },
  card:                   { light: "#fbfaf5", dark: "#2a2529" },
  cardForeground:         { light: "#2a2529", dark: "#f3f0e7" },
  popover:                { light: "#fbfaf5", dark: "#2a2529" },
  popoverForeground:      { light: "#2a2529", dark: "#f3f0e7" },
  primary:                { light: "#2a2529", dark: "#f3f0e7" },
  primaryForeground:      { light: "#f3f0e7", dark: "#2a2529" },
  secondary:              { light: "#e8e3d7", dark: "#38322c" },
  secondaryForeground:    { light: "#2a2529", dark: "#f3f0e7" },
  muted:                  { light: "#e8e3d7", dark: "#38322c" },
  mutedForeground:        { light: "#6e665a", dark: "#c3baa8" },
  accent:                 { light: "#dad3c4", dark: "#524b42" },
  accentForeground:       { light: "#2a2529", dark: "#f3f0e7" },
  destructive:            { light: "#b24a32", dark: "#d9664b" },
  destructiveForeground:  { light: "#f3f0e7", dark: "#1a171a" },
  success:                { light: "#4f7a52", dark: "#7aa37c" },
  successForeground:      { light: "#faf8f3", dark: "#1a171a" },
  border:                 { light: "#ded6c7", dark: "#38322c" },
  input:                  { light: "#ded6c7", dark: "#38322c" },
  ring:                   { light: "#2a2529", dark: "#c3baa8" },
};

export const font = {
  display: '"Brigends Expanded", "Arial Narrow", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
};

export const radius = {
  xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem",
  xl: "1.5rem", "2xl": "2rem", full: "9999px",
};

export const shadow = {
  xs: "0 1px 2px 0 rgb(42 37 41 / 0.04)",
  sm: "0 1px 3px 0 rgb(42 37 41 / 0.06), 0 1px 2px -1px rgb(42 37 41 / 0.06)",
  md: "0 4px 12px -2px rgb(42 37 41 / 0.08), 0 2px 6px -2px rgb(42 37 41 / 0.06)",
  lg: "0 12px 28px -6px rgb(42 37 41 / 0.12), 0 6px 12px -6px rgb(42 37 41 / 0.08)",
  xl: "0 24px 48px -12px rgb(42 37 41 / 0.18)",
};

/** Flattened { light, dark } maps, handy for a theme provider. */
export const themes = {
  light: Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.light])),
  dark:  Object.fromEntries(Object.entries(semantic).map(([k, v]) => [k, v.dark])),
};

export default { brand, sand, semantic, font, radius, shadow, themes };
