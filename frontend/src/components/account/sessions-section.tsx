'use client';

import { MonitorSmartphoneIcon } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  type AccountSession,
  useAccountSessions,
  useRevokeSession,
} from '@/lib/account/use-account';

import { AccountSection, TEXT_BUTTON } from './account-form';

/**
 * Where this account is signed in (`GET /me/sessions`), with a way to end any session but this
 * one. The current session is ended with "Sign out" instead, which also clears this browser.
 */
export function SessionsSection() {
  const sessions = useAccountSessions();

  return (
    <AccountSection
      id="account-sessions"
      title="Where you’re signed in"
      description="Sign out of any device you don’t recognise, then change your password."
    >
      <QueryState
        query={sessions}
        pending={<SessionsSkeleton />}
        errorTitle="We couldn't load your sessions"
        // The page is being read with a session, so an empty list means it ended meanwhile.
        empty={
          <EmptyState
            icon={<MonitorSmartphoneIcon className="size-6" strokeWidth={1.25} />}
            title="No active sessions"
            description="Your session may have just ended. Sign in again to manage your devices."
            className="py-8"
          />
        }
      >
        {(list) => (
          <ul className="divide-y divide-border border-y border-border">
            {list.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        )}
      </QueryState>
    </AccountSection>
  );
}

function SessionsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <Skeleton aria-hidden="true" className="h-14 w-full" />
      <Skeleton aria-hidden="true" className="h-14 w-full" />
      <span className="sr-only">Loading your sessions</span>
    </div>
  );
}

function SessionRow({ session }: { session: AccountSession }) {
  const revokeSession = useRevokeSession();
  // A failure is toasted. One that says the session had already ended is followed by a refetch
  // (`useRevokeSession` refreshes on either outcome) that takes the row away.
  const revoke = useAsyncAction(revokeSession.mutateAsync, {
    successMessage: 'Signed out of that device.',
  });

  const device = describeUserAgent(session.userAgent);

  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {device}
          {session.current ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">This device</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            session.ipAddress,
            `Last active ${formatDateTime(session.updatedAt)}`,
            `signed in ${formatDateTime(session.createdAt)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {session.current ? null : (
        <button
          type="button"
          className={TEXT_BUTTON}
          disabled={revoke.isPending}
          onClick={() => void revoke.run(session.id)}
          aria-label={`Sign out of ${device}`}
        >
          {revoke.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      )}
    </li>
  );
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : DATE_TIME.format(date);
}

/**
 * A readable name for a session's device. Approximate by nature: the user agent is whatever
 * the browser sent, so this is a label for recognising a device, never a security signal.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;

  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
