'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAsyncAction } from '@/hooks/use-async-action';
import { errorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

import { subscribeToNewsletter, type SubscribeResult } from './subscribe';

const newsletterSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address')
    .max(254, 'That email address is too long')
    .pipe(z.email('Enter a valid email address')),
});

type NewsletterValues = z.infer<typeof newsletterSchema>;

const OUTCOME_MESSAGE: Record<SubscribeResult['status'], string> = {
  subscribed: "You're subscribed. Look out for our next letter.",
  unavailable:
    "Newsletter sign-up isn't open yet, so your email hasn't been saved. Please check back soon.",
};

/**
 * Email sign-up for the newsletter banner. Rendered inside the banner's dark theme island, so
 * `foreground`, `muted-foreground` and `destructive` are the dark palette's light-on-dark
 * values in either site theme.
 *
 * Validation here is UX only. `useAsyncAction` refuses a second run while one is in flight,
 * and the disabled button blocks Enter-key resubmission too.
 */
export function NewsletterForm() {
  const inputId = useId();
  const errorId = useId();
  const statusId = useId();
  const [outcome, setOutcome] = useState<SubscribeResult['status'] | null>(null);

  const subscribe = useAsyncAction(subscribeToNewsletter, { toastOnError: false });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setOutcome(null);
    const result = await subscribe.run(email);
    if (!result) return;
    setOutcome(result.status);
    if (result.status === 'subscribed') reset();
  });

  const pending = isSubmitting || subscribe.isPending;
  const fieldError = errors.email?.message;
  const status = outcome
    ? OUTCOME_MESSAGE[outcome]
    : subscribe.error
      ? errorMessage(subscribe.error)
      : '';

  return (
    // From `lg` the form sits level with the heading, so its messages hang below it in the
    // banner's bottom padding instead of growing the column and nudging the input upwards.
    <form onSubmit={onSubmit} noValidate className="w-full lg:relative">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Email address
        </label>
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Enter your email address"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={cn(fieldError && errorId, statusId)}
          className={cn(
            // `flex-1` only in the `sm` row: in the phone column its zero basis would apply to
            // height and override `h-12`.
            'h-12 w-full min-w-0 rounded-lg border border-foreground/50 bg-background/35 px-4 text-[15px] text-foreground transition-colors sm:flex-1',
            'placeholder:text-foreground/65 hover:border-foreground/75',
            'focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/20 focus-visible:outline-none',
            'aria-invalid:border-destructive',
          )}
          {...register('email', {
            onChange: () => {
              setOutcome(null);
              subscribe.reset();
            },
          })}
        />
        <button
          type="submit"
          disabled={pending}
          className="group inline-flex h-12 shrink-0 items-center justify-center gap-3 rounded-lg bg-foreground px-6 text-[10px] font-semibold tracking-[0.26em] text-background uppercase transition-colors hover:bg-sand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Subscribing…' : 'Subscribe'}
          <ArrowRight
            aria-hidden="true"
            className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1"
          />
        </button>
      </div>

      <div className="lg:absolute lg:inset-x-0 lg:top-full">
        {/* The message is ivory, with the red on its icon only: over a photo this light, red
            text falls well short of 4.5:1, and colour must not carry the error on its own. */}
        {fieldError ? (
          <p
            id={errorId}
            role="alert"
            className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-foreground"
          >
            <CircleAlert
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            {fieldError}
          </p>
        ) : null}
        {/* Always mounted, so a screen reader hears each new outcome. */}
        <p
          id={statusId}
          role="status"
          className="mt-3 text-[13px] leading-5 text-foreground/85 empty:hidden"
        >
          {status}
        </p>
      </div>
    </form>
  );
}
