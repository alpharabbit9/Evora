'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { cn } from '@/lib/utils';

/** Set on <html> while the reveal runs; `globals.css` scopes the circle animation to it. */
const TRANSITION_ATTRIBUTE = 'data-theme-transition';

const subscribeToNothing = () => () => {};

/**
 * The switch behind both theme controls. `isDark` is `null` until hydration: the server
 * cannot read the stored choice, so the first client render must not depend on it either.
 * Until then the controls draw their state from the `dark:` variant alone, which is right
 * from first paint because next-themes sets the class on <html> before the page shows.
 */
function useThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const isDark = hydrated ? resolvedTheme === 'dark' : null;

  const toggle = () => {
    const root = document.documentElement;
    // A reveal is already running: let it finish rather than cut it off mid-sweep.
    if (root.hasAttribute(TRANSITION_ATTRIBUTE)) return;

    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('startViewTransition' in document)) {
      setTheme(next);
      return;
    }

    root.setAttribute(TRANSITION_ATTRIBUTE, '');
    // The browser freezes the current page as an image, runs this callback, then reveals the
    // live page underneath. `flushSync` commits the change, and with it next-themes' class
    // swap on <html>, before the callback returns, so the revealed page is the new theme.
    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next));
    });
    const clear = () => root.removeAttribute(TRANSITION_ATTRIBUTE);
    transition.finished.then(clear, clear);
  };

  return { isDark, toggle };
}

const iconProps = { className: 'size-[18px]', strokeWidth: 1.6, 'aria-hidden': true } as const;

/** Sun in light mode, moon in dark; one spins out as the other spins in. */
function ThemeIcon({ isDark }: { isDark: boolean | null }) {
  const reduceMotion = useReducedMotion();

  if (isDark === null) {
    return (
      <span className="grid size-[18px] place-items-center">
        <Sun {...iconProps} className={cn(iconProps.className, 'dark:hidden')} />
        <Moon {...iconProps} className={cn(iconProps.className, 'hidden dark:block')} />
      </span>
    );
  }

  const Icon = isDark ? Moon : Sun;
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, rotate: isDark ? -90 : 90, scale: 0.4 };

  return (
    <span className="grid size-[18px] place-items-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          className="col-start-1 row-start-1 grid place-items-center"
          initial={hidden}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={hidden}
          transition={{ duration: reduceMotion ? 0.15 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Icon {...iconProps} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Icon-only header control. The label stays put and `aria-pressed` carries the state. */
export function ThemeToggle({ className }: { className?: string }) {
  const { isDark, toggle } = useThemeSwitch();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Dark theme"
      aria-pressed={isDark ?? undefined}
      className={cn('group inline-flex shrink-0 items-center', className)}
    >
      <span className="transition-transform duration-300 group-hover:-translate-y-0.5">
        <ThemeIcon isDark={isDark} />
      </span>
    </button>
  );
}

/** Full-width row for the menu panel, where the header has no room for the icon. */
export function ThemeMenuSwitch({ className }: { className?: string }) {
  const { isDark, toggle } = useThemeSwitch();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark ?? undefined}
      className={cn(
        'flex w-full items-center justify-between gap-4 text-[15px] font-medium text-foreground/80 transition-colors hover:text-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-3">
        <ThemeIcon isDark={isDark} />
        Dark theme
      </span>
      {/* Drawn from the `dark:` variant, so it is right before hydration too. */}
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-muted ring-1 ring-border dark:bg-primary"
      >
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-card shadow-sm dark:translate-x-4" />
      </span>
    </button>
  );
}
