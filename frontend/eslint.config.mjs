import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.next-e2e/**',
    // Local production builds used to validate a change (plan.md Phase 5 onward).
    '.next-verify/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Design deliverable, kept as supplied; the app reads only its CSS tokens and font.
    'charcoal-ivory-theme/**',
  ]),
]);

export default eslintConfig;
