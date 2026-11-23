'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { TextField } from '@/components/common/text-field';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useUpdateProfile } from '@/lib/account/use-account';
import { ApiErrorCode, errorMessage, isApiError } from '@/lib/api-error';
import { signInPath } from '@/lib/safe-redirect';

import { AccountSection, applyServerFieldErrors, FormAlert, PRIMARY_BUTTON } from './account-form';

/** UX only: `PATCH /me` validates again, and its verdict lands on the same field. */
const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120, 'Name is too long'),
});

type ProfileValues = z.infer<typeof profileSchema>;

/**
 * The customer's name, the one profile field they edit here. The email is shown but not
 * editable: changing it needs a verified new address, and nothing can be delivered yet.
 */
export function ProfileSection({
  name,
  email,
  emailVerified,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name },
  });

  const save = useAsyncAction(updateProfile.mutateAsync, {
    toastOnError: false,
    successMessage: 'Your name has been updated.',
    onSuccess: (profile) => {
      reset({ name: profile.name });
      // The page above this form was rendered on the server with the old name.
      router.refresh();
    },
    onError: (error) => {
      if (isApiError(error) && error.code === ApiErrorCode.UNAUTHENTICATED) {
        router.replace(signInPath('/account'));
        return;
      }
      applyServerFieldErrors<ProfileValues>(error, ['name'], setError, setFocus);
    },
  });

  const failure = save.error;
  const fieldHandled = isApiError(failure) && failure.details.some((d) => d.field === 'name');

  const onSubmit = handleSubmit(async (values) => {
    await save.run({ name: values.name.trim() });
  });

  return (
    <AccountSection id="account-profile" title="Profile">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Name"
          autoComplete="name"
          registration={register('name')}
          error={errors.name?.message}
        />

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Email</span>
          <span className="break-all">{email}</span>
          <span className="text-xs text-muted-foreground">
            {emailVerified ? 'Verified.' : 'Not verified yet.'} Your email can’t be changed here.
          </span>
        </div>

        <FormAlert message={failure && !fieldHandled ? errorMessage(failure) : undefined} />

        <div>
          <button type="submit" disabled={save.isPending || !isDirty} className={PRIMARY_BUTTON}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </AccountSection>
  );
}
