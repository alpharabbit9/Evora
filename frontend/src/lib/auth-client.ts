'use client';

import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

import { API_BASE_URL } from './env';

/**
 * Talks to the Express backend's Better Auth handler. The session cookie is set by
 * the API on a different origin, so every request must carry credentials — and the
 * backend must list this origin in FRONTEND_ORIGIN/trustedOrigins.
 *
 * `role`/`status` are declared here only so the session user is typed. They are
 * server-owned, and `input: false` is what says so to the client as well: without it
 * `inferAdditionalFields` treats them as writable and makes them REQUIRED arguments to
 * `signUp.email` — so the only way to register would be to send a role, which the server
 * refuses outright (verified in backend/tests/integration/authorization.test.ts). This is
 * the type drift ADR 0006 warned about, and it is why the two declarations have to agree.
 *
 * UI checks are never authorization: the server authorizes every request regardless.
 */
export const authClient = createAuthClient({
  baseURL: `${API_BASE_URL}/auth`,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false },
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
