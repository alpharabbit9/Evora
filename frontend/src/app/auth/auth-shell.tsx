'use client';

import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Menu, User, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { forwardRef, Suspense, useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { Wordmark } from '@/components/layout/brand';
import { authClient } from '@/lib/auth-client';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { cn } from '@/lib/utils';

type AuthMode = 'signup' | 'signin';

const MIN_PASSWORD_LENGTH = 12;

const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120, 'Name is too long'),
  email: z.string().min(1, 'Enter your email').email('Enter a valid email'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `At least ${String(MIN_PASSWORD_LENGTH)} characters`)
    .max(128, 'Password is too long'),
});

const signInSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

type SignUpValues = z.infer<typeof signUpSchema>;
type SignInValues = z.infer<typeof signInSchema>;

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Men', href: '/collections/men' },
  { label: 'Women', href: '/collections/women' },
  { label: 'Journal', href: '/journal' },
] as const;

/*
 * Desktop choreography. Sign-in is the resting layout: glass card on the left, the boots on
 * their slab bottom-right. Switching to sign-up slides the card to the right and the boots to
 * the left, mirrored, so the two pass each other; the mirror swap is a crossfade timed to the
 * moment the boots are behind the frosted card, which hides it. Offsets are in `cqw` (the
 * stage is an inline-size container) so the scrollbar never skews the travel distance.
 */
const slide =
  'transition-[translate] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none';

const mirrorFade =
  'transition-opacity duration-[260ms] delay-[320ms] ease-linear motion-reduce:transition-none motion-reduce:delay-0';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D8B98B]';

const formFade = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as const };

function AuthShellInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [mobileMenu, setMobileMenu] = useState(false);

  const switchMode = useCallback((next: AuthMode) => {
    setMode(next);
    setMobileMenu(false);
    // Keep the address in step so a refresh or shared link lands on the same form; `next`
    // and any other params ride along untouched.
    const params = new URLSearchParams(window.location.search);
    params.set('mode', next);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, []);

  const isSignIn = mode === 'signin';
  const otherMode: AuthMode = isSignIn ? 'signup' : 'signin';
  const otherLabel = isSignIn ? 'Create Account' : 'Sign In';

  return (
    <div className="@container relative isolate flex min-h-dvh w-full flex-col overflow-hidden bg-[#0c0a08] text-[#F6EEE3] lg:block lg:h-dvh lg:min-h-[700px]">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <Image
          src="/images/Auth Page/clothes-rack-bg.jpeg"
          alt=""
          fill
          preload
          sizes="100vw"
          className="object-cover object-[46%_40%] lg:object-[60%_42%]"
        />
        <div className="absolute inset-0 bg-[#100c08]/45" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,6,4,0.55)_0%,rgba(10,8,6,0.05)_30%,rgba(10,8,6,0.1)_62%,rgba(8,6,4,0.7)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_95%_at_50%_40%,transparent_45%,rgba(6,5,3,0.55)_100%)]" />
      </div>

      <header className="relative z-30 flex items-center justify-end px-5 pt-5 sm:px-8 lg:absolute lg:inset-x-0 lg:top-0 lg:px-[7cqw] lg:pt-6">
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-sm text-[14px] text-[#F6EEE3]/72 transition-colors hover:text-[#F6EEE3]',
                focusRing,
              )}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => switchMode(otherMode)}
            className={cn(
              'ml-1 h-10 rounded-full border border-[#F6EEE3]/35 px-6 text-[14px] font-medium text-[#F6EEE3] transition-colors hover:border-[#F6EEE3]/65 hover:bg-[#F6EEE3]/6',
              focusRing,
            )}
          >
            {otherLabel}
          </button>
        </nav>

        <button
          type="button"
          className={cn('rounded-md p-1 text-[#F6EEE3]/85 lg:hidden', focusRing)}
          onClick={() => setMobileMenu((value) => !value)}
          aria-label="Toggle menu"
          aria-expanded={mobileMenu}
          aria-controls="mobile-auth-nav"
        >
          {mobileMenu ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </header>

      <AnimatePresence>
        {mobileMenu ? (
          <motion.nav
            id="mobile-auth-nav"
            aria-label="Mobile"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="absolute inset-x-4 top-16 z-40 rounded-2xl border border-white/10 bg-[#100d0a]/92 p-6 shadow-2xl backdrop-blur-xl lg:hidden"
          >
            <div className="flex flex-col gap-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm tracking-wide text-[#F6EEE3]/75 hover:text-[#F6EEE3]"
                >
                  {link.label}
                </Link>
              ))}
              <div className="my-1 h-px bg-white/10" />
              <button
                type="button"
                onClick={() => switchMode(otherMode)}
                className="text-left text-sm font-medium text-[#D8B98B]"
              >
                {otherLabel}
              </button>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>

      {/* The boots on their slab. Decorative, desktop only; below the card in z-order so the
          glass frosts them as they pass underneath. */}
      <div
        role="img"
        aria-label="Brown suede combat boots on a dark metal display block"
        className={cn(
          'absolute right-0 bottom-0 z-0 hidden aspect-[1.4] w-[min(39cqw,54dvh)] lg:block',
          slide,
          isSignIn ? 'translate-x-0' : 'translate-x-[calc(-100cqw_+_100%)]',
        )}
      >
        <div className={cn('absolute inset-0', mirrorFade, isSignIn ? 'opacity-100' : 'opacity-0')}>
          <ProductScene />
        </div>
        <div
          className={cn(
            'absolute inset-0 -scale-x-100',
            mirrorFade,
            isSignIn ? 'opacity-0' : 'opacity-100',
          )}
        >
          <ProductScene />
        </div>
      </div>

      {/* Invitation to the other form, on the open side of the stage. */}
      <div className="pointer-events-none absolute inset-0 z-10 hidden lg:block">
        <AnimatePresence initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: isSignIn ? 28 : -28 }}
            animate={{ opacity: 1, x: 0, transition: { delay: 0.45, duration: 0.5 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className={cn(
              'pointer-events-auto absolute top-[clamp(130px,33dvh,360px)] flex w-[min(30cqw,380px)] flex-col',
              isSignIn
                ? 'left-[59cqw] items-start text-left'
                : 'right-[59cqw] items-end text-right',
            )}
          >
            <SceneInvite mode={mode} onSwitch={() => switchMode(otherMode)} />
          </motion.div>
        </AnimatePresence>
      </div>

      <main
        className={cn(
          'relative z-20 mx-auto flex w-full max-w-[540px] flex-1 px-4 pt-4 pb-6 sm:px-6',
          'lg:absolute lg:top-[88px] lg:bottom-[clamp(24px,6dvh,72px)] lg:left-[7cqw] lg:mx-0 lg:w-[clamp(450px,44cqw,700px)] lg:max-w-none lg:p-0',
          slide,
          isSignIn ? 'lg:translate-x-0' : 'lg:translate-x-[calc(86cqw_-_100%)]',
        )}
      >
        <section
          aria-label={isSignIn ? 'Sign in' : 'Create account'}
          className="relative flex w-full flex-col overflow-hidden rounded-[28px] border border-white/[0.16] bg-[rgba(20,17,14,0.58)] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-[22px] backdrop-saturate-125"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_90%_at_0%_0%,rgba(214,177,124,0.09),transparent_55%)]"
          />

          <div className="relative flex h-[76px] shrink-0 items-center border-b border-white/[0.09] px-8 sm:px-12 lg:h-[clamp(68px,9dvh,86px)]">
            <Wordmark className={cn('rounded-sm text-[22px]/none text-[#F6EEE3]', focusRing)} />
          </div>

          <div className="relative flex flex-1 [scrollbar-width:thin] [scrollbar-color:rgba(246,238,227,0.18)_transparent] flex-col overflow-y-auto">
            <div className="m-auto w-full max-w-[496px] px-6 py-[clamp(1.5rem,5dvh,3.25rem)] sm:px-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={formFade}
                >
                  {isSignIn ? (
                    <SignInPanel
                      onSwitchToSignUp={() => switchMode('signup')}
                      router={router}
                      searchParams={searchParams}
                    />
                  ) : (
                    <SignUpPanel onSwitchToSignIn={() => switchMode('signin')} router={router} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/** The boots standing on the slab's top face, with the slab bleeding off the outer edge. */
function ProductScene() {
  return (
    <>
      <div className="absolute top-[-6%] left-[2%] aspect-[1700/925] w-[150%]">
        <Image
          src="/images/Auth Page/Industrial-Slab.png"
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 1024px) 60vw, 1px"
          className="object-contain"
        />
      </div>
      <div
        aria-hidden="true"
        className="absolute bottom-[19%] left-[32%] h-[5%] w-[58%] rounded-[50%] bg-black/60 blur-[10px]"
      />
      <div className="absolute bottom-[20%] left-[27%] aspect-[1448/1086] w-[66%]">
        <Image
          src="/images/Auth Page/combat-boots.png"
          alt=""
          fill
          loading="eager"
          sizes="(min-width: 1024px) 28vw, 1px"
          className="object-contain object-bottom drop-shadow-[0_16px_18px_rgba(0,0,0,0.45)]"
        />
      </div>
    </>
  );
}

function SceneInvite({ mode, onSwitch }: { mode: AuthMode; onSwitch: () => void }) {
  const copy =
    mode === 'signin'
      ? {
          eyebrow: 'New to EVORA?',
          title: ['Fresh drops,', 'first look.'],
          body: 'Create an account to save your details, follow your orders and hear about new arrivals first.',
          action: 'Create Account',
        }
      : {
          eyebrow: 'Welcome back',
          title: ['Good to see you', 'again.'],
          body: 'Sign in to continue your journey with us.',
          action: 'Sign In',
        };

  return (
    <>
      <p className="text-[12px] font-medium tracking-[0.34em] text-[#F6EEE3]/85 uppercase [text-shadow:0_1px_14px_rgba(0,0,0,0.6)]">
        {copy.eyebrow}
      </p>
      <h2 className="mt-5 font-heading text-[clamp(2.1rem,3.4cqw,3.4rem)] leading-[1.06] font-medium tracking-[-0.01em] text-[#F7F0E6] [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]">
        {copy.title.map((line) => (
          <span key={line} className="block whitespace-nowrap">
            {line}
          </span>
        ))}
      </h2>
      <p className="mt-5 max-w-[300px] text-[16px] leading-relaxed text-[#F6EEE3]/72 [text-shadow:0_1px_12px_rgba(0,0,0,0.6)] [@media(max-height:760px)]:hidden">
        {copy.body}
      </p>
      <button
        type="button"
        onClick={onSwitch}
        className={cn(
          'group mt-9 inline-flex h-14 items-center justify-center gap-3 rounded-full border border-[#F6EEE3]/45 bg-black/10 px-8 text-[15px] font-medium text-[#F6EEE3] backdrop-blur-sm transition-colors hover:border-[#F6EEE3]/80 hover:bg-[#F6EEE3]/8',
          focusRing,
        )}
      >
        {copy.action}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </>
  );
}

function PanelHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: readonly string[];
  body: string;
}) {
  return (
    <>
      <p className="text-[12px] font-medium tracking-[0.32em] text-[#D8B98B] uppercase">
        {eyebrow}
      </p>
      <h1 className="mt-4 font-heading text-[clamp(2.25rem,3.1cqw,3rem)] leading-[1.06] font-medium tracking-[-0.01em] text-[#F7F0E6]">
        {title.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h1>
      {/* Dropped on short desktop windows, where the card is height-bound; phones scroll. */}
      <p className="mt-[clamp(0.75rem,2dvh,1.25rem)] max-w-[360px] text-[16px] leading-relaxed text-[#F6EEE3]/65 lg:[@media(max-height:760px)]:hidden">
        {body}
      </p>
    </>
  );
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full p-1 text-[#F6EEE3]/50 transition-colors hover:text-[#F6EEE3]/85 focus-visible:outline-2 focus-visible:outline-[#D8B98B]"
      aria-label={shown ? 'Hide password' : 'Show password'}
    >
      {shown ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
    </button>
  );
}

function SwitchPrompt({
  question,
  action,
  onClick,
}: {
  question: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <p className="mt-[clamp(0.5rem,1.5dvh,1rem)] text-center text-[14px] text-[#F6EEE3]/55">
      {question}{' '}
      <button
        type="button"
        onClick={onClick}
        className="rounded-sm text-[#D8B98B] underline decoration-[#D8B98B]/40 underline-offset-4 transition-colors hover:text-[#F0D8B0] hover:decoration-[#F0D8B0]/70 focus-visible:outline-2 focus-visible:outline-[#D8B98B]"
      >
        {action}
      </button>
    </p>
  );
}

function SignUpPanel({
  onSwitchToSignIn,
  router,
}: {
  onSwitchToSignIn: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [formError, setFormError] = useState<string | undefined>();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const { error } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(error.message ?? 'Could not create the account. Please try again.');
      return;
    }
    router.push('/account');
    router.refresh();
  });

  return (
    <>
      <PanelHeading
        eyebrow="Create Account"
        title={['Join the EVORA', 'Community']}
        body="Be the first to know about new drops, exclusive offers and more."
      />

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-[clamp(1.5rem,4dvh,2.5rem)] flex flex-col gap-[clamp(0.75rem,1.6dvh,1rem)]"
      >
        <AuthInput
          id="signup-name"
          type="text"
          placeholder="Full name"
          autoComplete="name"
          icon={<User className="size-[18px]" />}
          error={errors.name?.message}
          {...register('name')}
        />
        <AuthInput
          id="signup-email"
          type="email"
          placeholder="Email address"
          autoComplete="email"
          icon={<Mail className="size-[18px]" />}
          error={errors.email?.message}
          {...register('email')}
        />
        <AuthInput
          id="signup-password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Password"
          autoComplete="new-password"
          icon={<Lock className="size-[18px]" />}
          error={errors.password?.message}
          trailing={
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          }
          {...register('password')}
        />

        {formError ? (
          <p role="alert" className="px-2 text-[13px] text-red-300">
            {formError}
          </p>
        ) : null}

        <PrimaryButton pending={isSubmitting} pendingLabel="Creating account…">
          Create Account
        </PrimaryButton>

        <Divider />

        <SocialButton
          icon={<GoogleIcon />}
          label="Continue with Google"
          onClick={() => toast('Google sign-in is not available yet.')}
        />

        <SwitchPrompt
          question="Already have an account?"
          action="Sign in"
          onClick={onSwitchToSignIn}
        />
      </form>
    </>
  );
}

function SignInPanel({
  onSwitchToSignUp,
  router,
  searchParams,
}: {
  onSwitchToSignUp: () => void;
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const [formError, setFormError] = useState<string | undefined>();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(error.message ?? 'Could not sign in. Check your details and try again.');
      return;
    }
    const destination = safeRedirectPath(searchParams.get('next'));
    router.push(destination);
    router.refresh();
  });

  return (
    <>
      <PanelHeading
        eyebrow="Sign In"
        title={['Welcome back', 'to EVORA']}
        body="Sign in to see your orders and check out faster."
      />

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-[clamp(1.5rem,4dvh,2.5rem)] flex flex-col gap-[clamp(0.75rem,1.6dvh,1rem)]"
      >
        <AuthInput
          id="signin-email"
          type="email"
          placeholder="Email address"
          autoComplete="email"
          icon={<Mail className="size-[18px]" />}
          error={errors.email?.message}
          {...register('email')}
        />
        <AuthInput
          id="signin-password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Password"
          autoComplete="current-password"
          icon={<Lock className="size-[18px]" />}
          error={errors.password?.message}
          trailing={
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          }
          {...register('password')}
        />

        {formError ? (
          <p role="alert" className="px-2 text-[13px] text-red-300">
            {formError}
          </p>
        ) : null}

        <PrimaryButton pending={isSubmitting} pendingLabel="Signing in…">
          Sign In
        </PrimaryButton>

        <Divider />

        <SocialButton
          icon={<GoogleIcon />}
          label="Continue with Google"
          onClick={() => toast('Google sign-in is not available yet.')}
        />

        <SwitchPrompt
          question="New to EVORA?"
          action="Create an account"
          onClick={onSwitchToSignUp}
        />
      </form>
    </>
  );
}

function PrimaryButton({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'group mt-[clamp(0.25rem,1dvh,0.75rem)] flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#EFE6D6] px-6 text-[15px] font-medium text-[#17120D] transition-colors hover:bg-[#FFF8EC] disabled:cursor-not-allowed disabled:opacity-55',
        focusRing,
      )}
    >
      {pending ? pendingLabel : children}
      <ArrowRight className="size-[18px] transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

interface AuthInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  error?: string;
}

const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { icon, trailing, error, ...props },
  ref,
) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="sr-only">
        {props.placeholder}
      </label>
      <div
        className={cn(
          'flex h-[54px] items-center gap-4 rounded-full border bg-white/[0.025] px-6 transition-colors focus-within:bg-white/[0.05]',
          error
            ? 'border-red-300/55'
            : 'border-white/[0.24] focus-within:border-[#D8B98B]/60 hover:border-white/[0.34]',
        )}
      >
        {icon ? <span className="shrink-0 text-[#F6EEE3]/70">{icon}</span> : null}
        <input
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${String(props.id)}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-[#F6EEE3] placeholder:text-[#F6EEE3]/60 focus:outline-none"
          {...props}
        />
        {trailing}
      </div>
      {error ? (
        <p id={`${String(props.id)}-error`} className="px-6 text-[12px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
});

function Divider() {
  return (
    <div className="flex items-center gap-4 py-[clamp(0.25rem,1dvh,0.5rem)]">
      <div className="h-px flex-1 bg-white/[0.16]" />
      <span className="text-[11px] tracking-[0.2em] text-[#F6EEE3]/50">OR</span>
      <div className="h-px flex-1 bg-white/[0.16]" />
    </div>
  );
}

function SocialButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[54px] w-full items-center justify-center gap-3 rounded-full border border-white/[0.24] text-[15px] font-medium text-[#F6EEE3]/90 transition-colors hover:border-white/40 hover:bg-white/[0.04] hover:text-[#F6EEE3]',
        focusRing,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function AuthShell() {
  return (
    <Suspense>
      <MotionConfig reducedMotion="user">
        <AuthShellInner />
      </MotionConfig>
    </Suspense>
  );
}
