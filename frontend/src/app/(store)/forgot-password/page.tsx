import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { PageTransition } from '@/components/layout/page-transition';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false },
};

/** Public: someone who forgot their password has no session. Not matched by `proxy.ts`. */
export default function ForgotPasswordPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter the email you signed up with and we’ll create a link to choose a new password.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </PageTransition>
  );
}
