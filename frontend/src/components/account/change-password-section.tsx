'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { TextField } from '@/components/common/text-field';
import { useHydrated } from '@/hooks/use-hydrated';
import { sessionsKey } from '@/lib/account/use-account';
import { authClient } from '@/lib/auth-client';
import { AuthErrorCode, authErrorMessage } from '@/lib/auth-errors';
import { MIN_PASSWORD_LENGTH, newPasswordField } from '@/lib/password';

import { AccountSection, FormAlert, PRIMARY_BUTTON } from './account-form';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, 'Enter the new password again'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords don’t match',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one',
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

const EMPTY: ChangePasswordValues = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * `POST /auth/change-password`, through Better Auth's client. Signing out other devices is on by
 * default: someone changing their password is often doing it because they suspect another
 * session. The session on this device is kept either way.
 */
export function ChangePasswordSection() {
  const queryClient = useQueryClient();
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [formError, setFormError] = useState<string | undefined>();
  const hydrated = useHydrated();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);

    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: revokeOthers,
    });

    if (error) {
      switch (error.code) {
        case AuthErrorCode.INVALID_PASSWORD:
          setError('currentPassword', {
            type: 'server',
            message: 'That isn’t your current password',
          });
          setFocus('currentPassword');
          return;
        case AuthErrorCode.PASSWORD_TOO_SHORT:
        case AuthErrorCode.PASSWORD_TOO_LONG:
          setError('newPassword', {
            type: 'server',
            message: authErrorMessage(error, 'Choose a different password'),
          });
          setFocus('newPassword');
          return;
        default:
          setFormError(authErrorMessage(error, 'We couldn’t change your password. Try again.'));
          return;
      }
    }

    reset(EMPTY);
    toast.success(
      revokeOthers
        ? 'Password changed. Your other devices have been signed out.'
        : 'Password changed.',
    );
    void queryClient.invalidateQueries({ queryKey: sessionsKey });
  });

  return (
    <AccountSection
      id="account-password"
      title="Password"
      description={`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`}
    >
      {/* `method="post"`: a native submit (before hydration) must never put passwords in the URL. */}
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          registration={register('currentPassword')}
          error={errors.currentPassword?.message}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          registration={register('newPassword')}
          error={errors.newPassword?.message}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          registration={register('confirmPassword')}
          error={errors.confirmPassword?.message}
        />

        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={revokeOthers}
            onChange={(event) => {
              setRevokeOthers(event.target.checked);
            }}
            className="size-4 accent-foreground"
          />
          Sign out of my other devices
        </label>

        <FormAlert message={formError} />

        <div>
          <button type="submit" disabled={!hydrated || isSubmitting} className={PRIMARY_BUTTON}>
            {isSubmitting ? 'Changing password…' : 'Change password'}
          </button>
        </div>
      </form>
    </AccountSection>
  );
}
