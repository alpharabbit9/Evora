import { Suspense } from 'react';

import { AdminOnly } from './admin-only';
import { AdminPageSkeleton } from './admin-skeleton';

/**
 * Every admin page's frame: its own role check (`AdminOnly`), behind the `<Suspense>` that reading
 * the session cookie needs under `cacheComponents`. The layout checks too, but a layout does not
 * re-run on client navigation, so each page has to ask again for itself.
 *
 * `children` may be a promise, for a page that has to await its route params first: that read
 * also has to happen inside the boundary.
 */
export function AdminPage({
  path,
  children,
}: {
  /** Where to return after signing in. */
  path: string | Promise<string>;
  children: React.ReactNode | Promise<React.ReactNode>;
}) {
  return (
    <Suspense fallback={<AdminPageSkeleton />}>
      <Gate path={path}>{children}</Gate>
    </Suspense>
  );
}

async function Gate({
  path,
  children,
}: {
  path: string | Promise<string>;
  children: React.ReactNode | Promise<React.ReactNode>;
}) {
  const [resolvedPath, content] = await Promise.all([path, children]);

  return <AdminOnly path={resolvedPath}>{() => content}</AdminOnly>;
}
