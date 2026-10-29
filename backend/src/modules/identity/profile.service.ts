import type { UserRole, UserStatus } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import type { UpdateProfileInput } from './identity.schemas.js';

/**
 * The authenticated user's own profile (API_SPEC.md §3).
 *
 * Boundary with Better Auth: anything credential- or session-shaped — sign-up, sign-in,
 * sign-out, password change, reset, verification — stays in Better Auth and is reached
 * through `/api/v1/auth/*`. This module only reads and writes two non-privileged profile
 * columns on the caller's own row, which is domain data, not authentication logic.
 *
 * `role`, `status`, `email` and `emailVerified` are never written here. The update names
 * its columns explicitly rather than spreading the request, so a field that becomes
 * writable has to be added on purpose.
 */
export interface ProfileView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  /** Exposed so the UI can offer admin navigation. The server still authorizes every call. */
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

/** Exactly the fields a client may see. Password hashes live on Account and never leave it. */
const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

export async function getProfile(userId: string): Promise<ProfileView> {
  // The session proved this row exists, so a miss here is a real inconsistency, not a 404.
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PROFILE_SELECT });
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileView> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.image === undefined ? {} : { image: input.image }),
    },
    select: PROFILE_SELECT,
  });
}
