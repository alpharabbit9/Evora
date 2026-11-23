/**
 * plan.md Phase 6: the WebGL rail shipped (6.4: go, 2026-11-17), so it is on by default.
 * `NEXT_PUBLIC_RAIL_3D=false` turns it off for a build (inlined at build time), as a kill
 * switch; a `?rail=3d` or `?rail=css` query overrides either per page load, so the two rails
 * can still be compared side by side on the same build.
 *
 * Being on is not enough to get it: `useRail3d` also requires a fine pointer that can hover,
 * no reduced-motion preference and WebGL2. Everyone else keeps the CSS rail.
 */
export const RAIL_3D_DEFAULT = process.env.NEXT_PUBLIC_RAIL_3D !== 'false';

export function rail3dRequested(search: string): boolean {
  const rail = new URLSearchParams(search).get('rail');
  if (rail === '3d') return true;
  if (rail === 'css') return false;
  return RAIL_3D_DEFAULT;
}
