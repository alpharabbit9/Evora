import { z } from 'zod';

import { idParams, opaqueId, paginationQuery } from '../../http/schemas.js';
import { MAX_MESSAGE_CHARS } from './assistant.service.js';

/** A guest's conversation token: 32 random bytes, base64url (assistant.service.ts). */
export const guestToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Not a conversation token');

/** The header a guest sends their token in when reading a conversation (never the URL). */
export const GUEST_TOKEN_HEADER = 'x-assistant-token';

export const messageBody = z.strictObject({
  conversationId: opaqueId.optional(),
  guestToken: guestToken.optional(),
  message: z
    .string()
    .trim()
    .min(1, 'Type a message')
    .max(MAX_MESSAGE_CHARS, `At most ${String(MAX_MESSAGE_CHARS)} characters`),
});

export const conversationParams = idParams('conversationId');

export const adminConversationListQuery = paginationQuery.extend({
  failed: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  owner: z.enum(['guest', 'customer']).optional(),
});
