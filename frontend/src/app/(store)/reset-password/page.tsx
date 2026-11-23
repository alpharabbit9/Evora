import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { PageTransition } from '@/components/layout/page-transition';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Choose a new password',
  // The address carries a reset token: keep it out of indexes and out of referrers.
  robots: { index: false },
  referrer: 'no-referrer',
};

/**
 * Where the API sends the browser from a reset link, with `?token=` when the token is valid and
 * `?error=INVALID_TOKEN` when not. Reading the query is request data, so under
 * `cacheComponents` the form streams in behind `<Suspense>`.
 */
export default function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  return (
    <PageTransition>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <Suspense fallback={<FormSkeleton />}>
          {searchParams.then((params) => {
            const token = typeof params.token === 'string' ? params.token : null;
            const failed = params.error !== undefined;
            return <ResetPasswordForm token={failed ? null : token} />;
          })}
        </Suspense>
      </div>
    </PageTransition>
  );
}

function FormSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <Skeleton aria-hidden="true" className="h-16 w-full" />
      <Skeleton aria-hidden="true" className="h-16 w-full" />
      <Skeleton aria-hidden="true" className="h-11 w-40" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
