import { z } from 'zod';

/** Mirrors Better Auth's `minPasswordLength`/`maxPasswordLength` on the API, which decide. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** UX only, for the change and reset forms: the server checks the length again. */
export const newPasswordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `At least ${String(MIN_PASSWORD_LENGTH)} characters`)
  .max(MAX_PASSWORD_LENGTH, 'Password is too long');
