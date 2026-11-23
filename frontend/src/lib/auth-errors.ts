/**
 * Better Auth's client resolves to `{ error }` instead of throwing, and that error has two
 * shapes here: Better Auth's own (`{ code, message, status }`) and, when the Express layer
 * answers first, this API's envelope (`{ error: { code, message } }`, a 429 from the rate
 * limiter or a 403 from the origin check). This turns either into copy that is safe to show.
 */
export interface AuthClientError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly status: number;
}

/** Better Auth's error codes that the account forms handle on a specific field. */
export const AuthErrorCode = {
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  INVALID_TOKEN: 'INVALID_TOKEN',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG: 'PASSWORD_TOO_LONG',
} as const;

export function authErrorMessage(error: AuthClientError, fallback: string): string {
  if (error.status === 429) {
    return 'Too many attempts. Please wait a moment and try again.';
  }

  if (error.status === 0 || error.status >= 500) {
    return fallback;
  }

  return error.message || fallback;
}
