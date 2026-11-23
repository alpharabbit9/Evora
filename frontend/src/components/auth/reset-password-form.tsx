'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormAlert, PRIMARY_BUTTON, TEXT_BUTTON } from '@/components/account/account-form';
import { TextField } from '@/components/common/text-field';
import { useHydrated } from '@/hooks/use-hydrated';
import { authClient } from '@/lib/auth-client';
import { AuthErrorCode, authErrorMessage } from '@/lib/auth-errors';
import { MIN_PASSWORD_LENGTH, newPasswordField } from '@/lib/password';

const resetSchema = z
  .object({
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, 'Enter the new password again'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords don’t match',
  });

type ResetValues = z.infer<typeof resetSchema>;

/**
 * `POST /auth/reset-password`. The link in the reset email goes to the API first, which checks
 * the token and sends the browser here with `?token=` (or `?error=INVALID_TOKEN`). The token is
 * checked again, and spent, when the new password is posted.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
  const [state, setState] = useState<'form' | 'invalid' | 'done'>(token ? 'form' : 'invalid');
  const [formError, setFormError] = useState<string | undefined>();
  const hydrated = useHydrated();

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    if (!token) return;
    setFormError(undefined);

    const { error } = await authClient.resetPassword({ newPassword, token });

    if (error) {
      if (error.code === AuthErrorCode.INVALID_TOKEN) {
        setState('invalid');
        return;
      }
      if (
        error.code === AuthErrorCode.PASSWORD_TOO_SHORT ||
        error.code === AuthErrorCode.PASSWORD_TOO_LONG
      ) {
        setError('newPassword', {
          type: 'server',
          message: authErrorMessage(error, 'Choose a different password'),
        });
        setFocus('newPassword');
        return;
      }
      setFormError(authErrorMessage(error, 'We couldn’t reset your password. Please try again.'));
      return;
    }

    setState('done');
  });

  if (state === 'invalid') {
    return (
      <div role="alert" className="flex flex-col gap-4 text-sm leading-6">
        <p className="font-medium">This reset link can’t be used</p>
        <p className="text-muted-foreground">
          It may have expired, been used already, or been copied incompletely. Reset links last one
          hour and work once.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/forgot-password" className={PRIMARY_BUTTON}>
            Request a new link
          </Link>
          <Link href="/sign-in" className={TEXT_BUTTON}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div role="status" className="flex flex-col gap-4 text-sm leading-6">
        <p className="font-medium">Your password has been changed</p>
        <p className="text-muted-foreground">
          For your security, every device signed in to this account has been signed out. Sign in
          with your new password to continue.
        </p>
        <div>
          <Link href="/sign-in" className={PRIMARY_BUTTON}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // `method="post"`: a native submit (before hydration) must never put passwords in the URL.
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        registration={register('newPassword')}
        error={errors.newPassword?.message}
        hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        registration={register('confirmPassword')}
        error={errors.confirmPassword?.message}
      />

      <FormAlert message={formError} />

      <div>
        <button type="submit" disabled={!hydrated || isSubmitting} className={PRIMARY_BUTTON}>
          {isSubmitting ? 'Saving…' : 'Set new password'}
        </button>
      </div>
    </form>
  );
}
