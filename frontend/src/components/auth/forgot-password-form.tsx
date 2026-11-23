'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormAlert, PRIMARY_BUTTON, TEXT_BUTTON } from '@/components/account/account-form';
import { TextField } from '@/components/common/text-field';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';

const forgotSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email'),
});

type ForgotValues = z.infer<typeof forgotSchema>;

/**
 * `POST /auth/request-password-reset`. The API answers the same way for a known and an unknown
 * address, so the confirmation here does too: it never says whether an account exists.
 *
 * Reset links are only written to the outbox until email delivery lands (M9), so this copy does
 * not tell anyone to check their inbox.
 */
export function ForgotPasswordForm() {
  const [submittedTo, setSubmittedTo] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(undefined);

    const { error } = await authClient.requestPasswordReset({
      email: email.trim(),
      // Better Auth checks this against the API's trusted origins before using it.
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setFormError(authErrorMessage(error, 'We couldn’t start a reset. Please try again.'));
      return;
    }

    setSubmittedTo(email.trim());
  });

  if (submittedTo) {
    return (
      <div role="status" className="flex flex-col gap-4 text-sm leading-6">
        <p className="font-medium">Request received</p>
        <p className="text-muted-foreground">
          If an account uses <span className="break-all text-foreground">{submittedTo}</span>, a
          reset link has been created for it. It stays valid for one hour.
        </p>
        <p className="text-muted-foreground">
          We aren’t sending emails yet, so the link won’t arrive in your inbox. Contact the store if
          you need to get back into your account.
        </p>
        <p>
          <Link href="/sign-in" className={TEXT_BUTTON}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        registration={register('email')}
        error={errors.email?.message}
      />

      <p className="text-xs leading-5 text-muted-foreground">
        Email delivery isn’t switched on yet, so a reset link can be created but not sent to you.
      </p>

      <FormAlert message={formError} />

      <div className="flex flex-wrap items-center gap-5">
        <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON}>
          {isSubmitting ? 'Requesting…' : 'Request reset link'}
        </button>
        <Link href="/sign-in" className={TEXT_BUTTON}>
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
