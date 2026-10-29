import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { created, noContent, route } from '../../http/route.js';
import { idParams } from '../../http/schemas.js';
import { createAddress, deleteAddress, listAddresses, updateAddress } from './addresses.service.js';
import { createAddressBody, updateAddressBody, updateProfileBody } from './identity.schemas.js';
import { getProfile, updateProfile } from './profile.service.js';
import { listOwnSessions, revokeOwnSession } from './sessions.service.js';

/**
 * The authenticated account subtree, `/api/v1/me` (API_SPEC.md §3).
 *
 * `requireAuth` is applied to the router, not to each route. A new endpoint added below is
 * therefore protected by default — the failure mode of a forgotten guard is "this router
 * is unreachable without a session", not "this one endpoint is public".
 *
 * Every handler derives its subject from `actorOf(req)`, the verified session. No handler
 * reads a user id out of the path, the body or a header, which is why none of them can be
 * pointed at another account.
 *
 * Credentials and sessions are Better Auth's: registration, sign-in, sign-out, password
 * change, password reset and email verification are served under `/api/v1/auth` and are
 * deliberately not duplicated here.
 */
export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/',
  route({
    handler: ({ req }) => getProfile(actorOf(req).id),
  }),
);

meRouter.patch(
  '/',
  route({
    body: updateProfileBody,
    handler: ({ req, body }) => updateProfile(actorOf(req).id, body),
  }),
);

meRouter.get(
  '/sessions',
  route({
    handler: ({ req }) => {
      const actor = actorOf(req);
      return listOwnSessions(actor.id, actor.sessionId);
    },
  }),
);

meRouter.delete(
  '/sessions/:sessionId',
  route({
    params: idParams('sessionId'),
    handler: async ({ req, params }) => {
      await revokeOwnSession(actorOf(req).id, params.sessionId, fromNodeHeaders(req.headers));
      return noContent();
    },
  }),
);

meRouter.get(
  '/addresses',
  route({
    handler: ({ req }) => listAddresses(actorOf(req).id),
  }),
);

meRouter.post(
  '/addresses',
  route({
    body: createAddressBody,
    handler: async ({ req, body }) => created(await createAddress(actorOf(req).id, body)),
  }),
);

meRouter.patch(
  '/addresses/:addressId',
  route({
    params: idParams('addressId'),
    body: updateAddressBody,
    handler: ({ req, params, body }) => updateAddress(actorOf(req).id, params.addressId, body),
  }),
);

meRouter.delete(
  '/addresses/:addressId',
  route({
    params: idParams('addressId'),
    handler: async ({ req, params }) => {
      await deleteAddress(actorOf(req).id, params.addressId);
      return noContent();
    },
  }),
);
